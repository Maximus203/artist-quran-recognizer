import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withLock } from "./lock";
import { REVIEW_SCHEMA, newAnnotation, type Annotation } from "./review";
import { updateReview } from "./review-update";
import { readReview, saveSession, sessionDir, type Session } from "./store";

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AUDIO = "c".repeat(64);
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let dir: string;
let previousDir: string | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-review-update-"));
  previousDir = process.env.AQR_REVIEW_DIR;
  process.env.AQR_REVIEW_DIR = dir;
  const session: Session = {
    id: ID,
    name: "essai.mp3",
    extension: ".mp3",
    audio_sha256: AUDIO,
    size: 3,
    created_at: "2026-10-22T09:00:00.000Z",
    state: "done",
    error: null,
    started_at: null,
    finished_at: null,
    prediction_sha256: null,
    pid: null,
  };
  await saveSession(session);
});
afterEach(async () => {
  if (previousDir === undefined) delete process.env.AQR_REVIEW_DIR;
  else process.env.AQR_REVIEW_DIR = previousDir;
  await rm(dir, { recursive: true, force: true });
});

const draft = (n: number, tester: string, over: Partial<Annotation> = {}) => ({
  ...newAnnotation({
    id: uuid(n),
    tester,
    start: n * 10,
    end: n * 10 + 4,
    now: `2026-10-22T10:0${n}:00.000Z`,
  }),
  tags: ["wrong_verse"],
  type: "wrong_verse" as const,
  ...over,
});
const body = (annotations: Annotation[], deleted: string[] = []) => ({
  schema: REVIEW_SCHEMA,
  session_id: ID,
  audio_sha256: AUDIO,
  prediction_sha256: null,
  annotations,
  updated_at: "2026-10-22T10:30:00.000Z",
  deleted_ids: deleted,
});

describe("withLock", () => {
  it("exécute les tâches d'une même clé l'une après l'autre", async () => {
    const order: string[] = [];
    const slow = withLock("k", async () => {
      order.push("début A");
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push("fin A");
    });
    const fast = withLock("k", async () => {
      order.push("B");
    });
    await Promise.all([slow, fast]);
    expect(order).toEqual(["début A", "fin A", "B"]);
  });
  it("continue après une tâche en échec", async () => {
    await expect(
      withLock("k2", async () => {
        throw new Error("boum");
      }),
    ).rejects.toThrow("boum");
    await expect(withLock("k2", async () => 7)).resolves.toBe(7);
  });
});

describe("updateReview : fusion par identifiant", () => {
  it("crée la revue au premier envoi", async () => {
    const review = await updateReview(ID, body([draft(1, "Awa")]));
    expect(review.annotations).toHaveLength(1);
    expect((await readReview(ID))?.schema).toBe("aqr.review/2");
  });

  it("deux testeurs qui écrivent EN MÊME TEMPS ne s'écrasent pas", async () => {
    await Promise.all([
      updateReview(ID, body([draft(1, "Awa")])),
      updateReview(ID, body([draft(2, "Moussa")])),
      updateReview(ID, body([draft(3, "Cherif")])),
    ]);
    const stored = await readReview(ID);
    expect(stored?.annotations.map((a) => a.tester).sort()).toEqual([
      "Awa",
      "Cherif",
      "Moussa",
    ]);
  });

  it("répond avec la revue fusionnée (le client y retrouve les autres testeurs)", async () => {
    await updateReview(ID, body([draft(1, "Awa")]));
    const review = await updateReview(ID, body([draft(2, "Moussa")]));
    expect(review.annotations.map((a) => a.id)).toEqual([uuid(1), uuid(2)]);
  });

  it("conflit sur un même identifiant : le dernier updated_at gagne", async () => {
    await updateReview(
      ID,
      body([
        draft(1, "Awa", {
          description: "récent",
          updated_at: "2026-10-22T11:00:00.000Z",
        }),
      ]),
    );
    const review = await updateReview(
      ID,
      body([
        draft(1, "Moussa", {
          description: "périmé",
          updated_at: "2026-10-22T10:00:00.000Z",
        }),
      ]),
    );
    expect(review.annotations[0].description).toBe("récent");
    expect(review.annotations[0].tester).toBe("Awa");
  });

  it("supprime uniquement les identifiants demandés", async () => {
    await updateReview(ID, body([draft(1, "Awa"), draft(2, "Moussa")]));
    const review = await updateReview(ID, body([], [uuid(1)]));
    expect(review.annotations.map((a) => a.id)).toEqual([uuid(2)]);
  });

  it("garde une révision de l'état précédent à chaque changement", async () => {
    await updateReview(ID, body([draft(1, "Awa")]));
    await updateReview(ID, body([draft(2, "Moussa")]));
    const revisions = await readdir(path.join(sessionDir(ID), "revisions"));
    expect(revisions).toHaveLength(1);
    const saved = JSON.parse(
      await readFile(path.join(sessionDir(ID), "revisions", revisions[0]), "utf8"),
    );
    expect(saved.annotations).toHaveLength(1);
  });

  it("n'écrit pas de révision quand rien ne change", async () => {
    await updateReview(ID, body([draft(1, "Awa")]));
    await updateReview(ID, body([draft(1, "Awa")]));
    await expect(
      readdir(path.join(sessionDir(ID), "revisions")),
    ).rejects.toThrow();
  });

  it("lit une revue v1 déjà sur le disque et la complète sans rien perdre", async () => {
    const { atomicJson } = await import("./store");
    await atomicJson(path.join(sessionDir(ID), "review.json"), {
      schema: "aqr.review/1",
      session_id: ID,
      audio_sha256: AUDIO,
      prediction_sha256: null,
      annotations: [
        {
          id: uuid(9),
          mode: "point",
          start_s: 31.2,
          end_s: null,
          type: "timing",
          description: "décalé",
          expected_ref: null,
          target_index: null,
          status: "confirmed",
          updated_at: "2026-10-20T10:00:00.000Z",
        },
      ],
      updated_at: "2026-10-20T10:00:00.000Z",
    });
    const review = await updateReview(ID, body([draft(1, "Awa")]));
    const old = review.annotations.find((a) => a.id === uuid(9));
    expect(old?.tester).toBe("inconnu");
    expect(old?.tags).toEqual(["display_offset"]);
    expect(review.annotations).toHaveLength(2);
  });

  it("refuse une revue d'un autre audio, d'une autre session ou un temps hors durée", async () => {
    await expect(
      updateReview(ID, { ...body([]), audio_sha256: "d".repeat(64) }),
    ).rejects.toThrow(/ne correspond pas/);
    await expect(
      updateReview(ID, { ...body([]), session_id: uuid(5) }),
    ).rejects.toThrow(/ne correspond pas/);
    await expect(
      updateReview(
        ID,
        body([draft(1, "Awa", { start_s: 999999, end_s: 1000003 })]),
      ),
    ).rejects.toThrow(/hors durée/);
  });

  it("refuse un corps invalide sans rien écrire", async () => {
    await expect(updateReview(ID, { n: "importe quoi" })).rejects.toThrow();
    expect(await readReview(ID)).toBeNull();
  });
});
