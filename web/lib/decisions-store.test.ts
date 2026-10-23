import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DecisionsError, parseDecisions } from "./decisions";
import { intervalFingerprint } from "./decisions-fingerprint";
import {
  DecisionsForbiddenError,
  decisionsView,
  updateDecisions,
  type Actor,
} from "./decisions-store";
import { REVIEW_SCHEMA, newAnnotation } from "./review";
import { updateReview } from "./review-update";
import { saveSession, sessionDir, type Session } from "./store";

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const AUDIO = "c".repeat(64);
const owner: Actor = { username: "Amina", isOwner: true, isAdmin: false };
const admin: Actor = { username: "Chérif", isOwner: false, isAdmin: true };

const verse = (
  ref: string,
  t: [number, number],
  over: Record<string, unknown> = {},
) => ({
  kind: "verse",
  ref,
  words: [1, 4],
  partial: false,
  status: "recognized",
  t,
  time_interpolated: false,
  confidence: 0.9,
  candidates: [],
  repetition: false,
  text: null,
  translation: null,
  ...over,
});
const UNCERTAIN = verse("11:61", [48.2, 62.6], {
  status: "uncertain",
  words: [1, 10],
  candidates: ["11:61", "7:73"],
});
const INTERVALS = [verse("112:1", [1, 4]), UNCERTAIN, verse("112:3", [70, 73])];

function prediction(intervals: unknown[]) {
  return {
    schema: "aqr.recognition/1",
    source: { file: "source.mp3", sha256: AUDIO, duration_s: 200 },
    engine: {
      asr: "test",
      segmenter: "test",
      matcher: "test",
      decoder: "test",
      constrained: false,
      corpus: "test",
    },
    decoder: { merge_max_gap_s: 5 },
    timing: { total_s: 1 },
    windows: 1,
    warnings: [],
    intervals,
  };
}
const sha = (data: Buffer | string) =>
  createHash("sha256").update(data).digest("hex");

let dir: string;
let previousDir: string | undefined;
async function writePrediction(intervals: unknown[]): Promise<string> {
  const raw = JSON.stringify(prediction(intervals));
  await writeFile(
    path.join(sessionDir(ID), "prediction.recognition.json"),
    raw,
    "utf8",
  );
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
    prediction_sha256: sha(raw),
    pid: null,
  };
  await saveSession(session);
  return raw;
}
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-decisions-"));
  previousDir = process.env.AQR_REVIEW_DIR;
  process.env.AQR_REVIEW_DIR = dir;
  await mkdir(sessionDir(ID), { recursive: true });
  await writePrediction(INTERVALS);
});
afterEach(async () => {
  if (previousDir === undefined) delete process.env.AQR_REVIEW_DIR;
  else process.env.AQR_REVIEW_DIR = previousDir;
  await rm(dir, { recursive: true, force: true });
});

const choose = (index = 1, value: Record<string, unknown> = {}) => ({
  ops: [
    {
      op: "decide",
      item: "uncertain",
      index,
      kind: "choose",
      value: { ref: "11:61", words: [1, 10], ...value },
      evidence: { listened: true, listened_s: 14.4, device: "desktop" },
    },
  ],
});
const read = async () =>
  parseDecisions(
    JSON.parse(
      await readFile(path.join(sessionDir(ID), "decisions.json"), "utf8"),
    ),
  );

describe("décider", () => {
  it("enregistre la décision, fixe l'empreinte et l'auteur côté serveur", async () => {
    const view = await updateDecisions(ID, choose(), owner);
    const doc = await read();
    const [decision] = doc.decisions;
    expect(decision.target.fingerprint).toBe(
      intervalFingerprint(UNCERTAIN as never),
    );
    expect(decision.target.snapshot).toMatchObject({
      ref: "11:61",
      status: "uncertain",
    });
    expect(decision.decided_by).toBe("Amina");
    expect(decision.use_for_training).toBe(true);
    expect(doc.revision).toBe(1);
    expect(view.decisions[0].state).toBe("applied");
    expect(view.stale).toBe(false);
  });

  it("ne modifie jamais la prédiction", async () => {
    const before = await writePrediction(INTERVALS);
    await updateDecisions(ID, choose(), owner);
    await updateDecisions(
      ID,
      { ops: [{ op: "withdraw", id: (await read()).decisions[0].id }] },
      owner,
    );
    const after = await readFile(
      path.join(sessionDir(ID), "prediction.recognition.json"),
      "utf8",
    );
    expect(sha(after)).toBe(sha(before));
  });

  it("une nouvelle décision sur la même cible remplace la précédente, sans la supprimer", async () => {
    await updateDecisions(ID, choose(), owner);
    await updateDecisions(ID, choose(1, { ref: "7:73" }), owner);
    const doc = await read();
    expect(doc.decisions).toHaveLength(2);
    expect(doc.decisions[0].superseded_by).toBe(doc.decisions[1].id);
    expect(doc.decisions[1].revision).toBe(2);
  });

  it("refuse ce que le moteur refuserait", async () => {
    await expect(updateDecisions(ID, choose(9), owner)).rejects.toThrow(
      DecisionsError,
    );
    await expect(updateDecisions(ID, choose(0), owner)).rejects.toThrow(
      /n'est pas un passage incertain/,
    );
    await expect(
      updateDecisions(ID, choose(1, { ref: "0:1" }), owner),
    ).rejects.toThrow(DecisionsError);
    await expect(
      updateDecisions(
        ID,
        {
          ops: [
            {
              op: "decide",
              item: "cut",
              index: 1,
              kind: "choose",
              value: { ref: "11:61", words: [1, 2] },
            },
          ],
        },
        owner,
      ),
    ).rejects.toThrow(/ne répond pas/);
    await expect(updateDecisions(ID, { ops: [] }, owner)).rejects.toThrow();
  });

  it("annuler garde la décision dans l'historique", async () => {
    await updateDecisions(ID, choose(), owner);
    const id = (await read()).decisions[0].id;
    const view = await updateDecisions(
      ID,
      { ops: [{ op: "withdraw", id }] },
      owner,
    );
    expect(view.decisions[0].state).toBe("withdrawn");
    expect((await read()).decisions[0].withdrawn_at).not.toBeNull();
    await expect(
      updateDecisions(
        ID,
        { ops: [{ op: "withdraw", id: crypto.randomUUID() }] },
        owner,
      ),
    ).rejects.toThrow(/inconnue/);
  });
});

describe("consentement d'entraînement", () => {
  it("activé pour le propriétaire, jamais pour l'administrateur qui n'est pas propriétaire", async () => {
    await updateDecisions(ID, choose(), admin);
    const doc = await read();
    expect(doc.consent.training).toBe(false);
    expect(doc.decisions[0].use_for_training).toBe(false);
  });

  it("seul le propriétaire le modifie", async () => {
    await expect(
      updateDecisions(ID, { ops: [{ op: "consent", training: true }] }, admin),
    ).rejects.toThrow(DecisionsForbiddenError);
    await updateDecisions(ID, choose(), owner);
    await updateDecisions(
      ID,
      { ops: [{ op: "consent", training: false }] },
      owner,
    );
    expect((await read()).consent.training).toBe(false);
    await updateDecisions(ID, choose(1, { ref: "7:73" }), owner);
    expect((await read()).decisions.at(-1)?.use_for_training).toBe(false);
  });

  it("un administrateur qui corrige ne change pas le consentement du propriétaire", async () => {
    await updateDecisions(ID, choose(), owner);
    await updateDecisions(ID, choose(1, { ref: "7:73" }), admin);
    const doc = await read();
    expect(doc.consent.training).toBe(true);
    expect(doc.decisions.at(-1)?.use_for_training).toBe(false);
  });

  it("se règle décision par décision", async () => {
    await updateDecisions(ID, choose(), owner);
    const id = (await read()).decisions[0].id;
    await updateDecisions(
      ID,
      { ops: [{ op: "training", id, use: false }] },
      owner,
    );
    expect((await read()).decisions[0].use_for_training).toBe(false);
  });
});

describe("nouvelle analyse : décisions orphelines", () => {
  it("une décision dont le passage a changé est orpheline, avec une suggestion", async () => {
    await updateDecisions(ID, choose(), owner);
    await writePrediction([
      verse("112:1", [1, 4]),
      { ...UNCERTAIN, t: [48.5, 62.6] },
    ]);
    const view = await decisionsView(ID, owner);
    expect(view.stale).toBe(true);
    expect(view.decisions[0].state).toBe("orphan");
    expect(view.orphans[0].suggestion).toMatchObject({ index: 1 });
  });

  it("rattacher la décision au passage suggéré l'applique de nouveau, l'ancienne reste dans l'historique", async () => {
    await updateDecisions(ID, choose(), owner);
    await writePrediction([
      verse("112:1", [1, 4]),
      { ...UNCERTAIN, t: [48.5, 62.6] },
    ]);
    const id = (await read()).decisions[0].id;
    const view = await updateDecisions(
      ID,
      { ops: [{ op: "reattach", id, index: 1 }] },
      owner,
    );
    const states = Object.fromEntries(
      view.decisions.map((d) => [d.id, d.state]),
    );
    expect(states[id]).toBe("superseded");
    expect(view.decisions.filter((d) => d.state === "applied")).toHaveLength(1);
    expect(view.orphans).toHaveLength(0);
    expect(view.stale).toBe(false);
  });

  it("des décisions toujours valables restent appliquées après une analyse identique", async () => {
    await updateDecisions(ID, choose(), owner);
    await writePrediction(INTERVALS);
    expect((await decisionsView(ID, owner)).orphans).toHaveLength(0);
  });
});

describe("décision posée sur un signalement", () => {
  const NOTE = "11111111-1111-4111-8111-111111111111";
  async function addConfirmedNote() {
    const annotation = {
      ...newAnnotation({ id: NOTE, tester: "Amina", start: 30, end: 33 }),
      tags: ["quran_undetected"],
      type: "other" as const,
      status: "confirmed" as const,
    };
    await updateReview(ID, {
      schema: REVIEW_SCHEMA,
      session_id: ID,
      audio_sha256: AUDIO,
      prediction_sha256: (await readSession()).prediction_sha256,
      annotations: [annotation],
      updated_at: new Date().toISOString(),
      deleted_ids: [],
    });
  }
  const readSession = async () =>
    JSON.parse(
      await readFile(path.join(sessionDir(ID), "session.json"), "utf8"),
    ) as Session;
  const setRef = (ids: string[]) => ({
    ops: [
      {
        op: "decide",
        item: "report",
        index: null,
        review_ids: ids,
        kind: "set_ref",
        value: { ref: "112:2", words: [1, 2], t: [30, 33] },
      },
    ],
  });

  it("exige un signalement confirmé qui existe", async () => {
    await expect(updateDecisions(ID, setRef([NOTE]), owner)).rejects.toThrow(
      /inconnu/,
    );
    await expect(updateDecisions(ID, setRef([]), owner)).rejects.toThrow(
      DecisionsError,
    );
    await addConfirmedNote();
    const view = await updateDecisions(ID, setRef([NOTE]), owner);
    expect(view.decisions[0]).toMatchObject({ state: "report" });
  });

  it("devient orpheline si le signalement disparaît", async () => {
    await addConfirmedNote();
    await updateDecisions(ID, setRef([NOTE]), owner);
    await updateReview(ID, {
      schema: REVIEW_SCHEMA,
      session_id: ID,
      audio_sha256: AUDIO,
      prediction_sha256: (await readSession()).prediction_sha256,
      annotations: [],
      updated_at: new Date().toISOString(),
      deleted_ids: [NOTE],
    });
    const view = await decisionsView(ID, owner);
    expect(view.decisions[0].state).toBe("orphan");
    expect(view.orphans[0].suggestion).toBeNull();
  });
});
