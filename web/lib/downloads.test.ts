import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "./access";
import { openDatabase, type Db } from "./db";
import { buildDownloads, type JobSnapshot } from "./downloads";
import { recordExport } from "./export-index";
import { createUser } from "./users";

/**
 * Page « Téléchargements » : une seule vue des exports (en attente, en cours, prêts, échoués), groupés par
 * génération. Les règles de visibilité sont celles des générations (`access.ts`) : propriétaire, portée
 * publique, administrateur — appliquées ICI, côté serveur.
 */
let db: Db;
let admin: number;
let awa: number;
let moussa: number;
const T0 = "2026-11-10T10:00:00.000Z";

const adminV = (): Actor => ({ id: admin, role: "admin" });
const awaV = (): Actor => ({ id: awa, role: "user" });
const moussaV = (): Actor => ({ id: moussa, role: "recitant" });

const session = (
  id: string,
  owner: number | null,
  visibility: "private" | "global",
  name = id,
) =>
  db
    .prepare(
      `INSERT INTO session_meta (id, owner_id, name, original_name, visibility, created_at, updated_at, size_bytes, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'done')`,
    )
    .run(id, owner, name, `${id}.wav`, visibility, T0, T0);

const file = (
  id: string,
  sessionId: string,
  owner: number,
  bytes = 100,
  at = T0,
) =>
  recordExport(db, {
    id,
    sessionId,
    ownerId: owner,
    name: `${id}.mp4`,
    bytes,
    createdAt: at,
  });

const job = (over: Partial<JobSnapshot> & { id: string }): JobSnapshot => ({
  sessionId: "s-awa",
  userId: awa,
  state: "queued",
  progress: "En attente",
  ratio: 0,
  files_done: 0,
  files_total: null,
  error: null,
  createdAt: T0,
  finishedAt: null,
  options: {},
  reuse: true,
  download: null,
  downloads: [],
  ...over,
});

beforeEach(() => {
  db = openDatabase(":memory:");
  admin = createUser(db, { username: "Root", passwordHash: "x" }).id;
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin);
  awa = createUser(db, { username: "Awa", passwordHash: "x" }).id;
  moussa = createUser(db, {
    username: "Moussa",
    passwordHash: "x",
    role: "recitant",
  }).id;
  session("s-awa", awa, "private", "Yusuf");
  session("s-pub", awa, "global", "Maryam publique");
  session("s-moussa", moussa, "private", "Fatiha");
});
afterEach(() => db.close());

describe("visibilité des fichiers prêts", () => {
  beforeEach(() => {
    file("f-awa", "s-awa", awa);
    file("f-pub", "s-pub", awa);
    file("f-moussa", "s-moussa", moussa);
  });

  it("un compte voit ses générations et les publiques, jamais le privé d'autrui", () => {
    const out = buildDownloads(db, moussaV(), []);
    expect(out.groups.map((g) => g.session_id).sort()).toEqual([
      "s-moussa",
      "s-pub",
    ]);
    const ids = out.groups.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain("f-awa");
  });

  it("l'administrateur voit tout, avec le propriétaire de chaque génération", () => {
    const out = buildDownloads(db, adminV(), []);
    expect(out.groups.map((g) => g.session_id).sort()).toEqual([
      "s-awa",
      "s-moussa",
      "s-pub",
    ]);
    expect(out.groups.find((g) => g.session_id === "s-awa")?.owner_name).toBe(
      "Awa",
    );
  });

  it("supprimer n'est offert qu'au propriétaire de la génération et à l'administrateur", () => {
    const pub = (viewer: Actor) =>
      buildDownloads(db, viewer, [])
        .groups.find((g) => g.session_id === "s-pub")
        ?.items.find((i) => i.id === "f-pub");
    expect(pub(moussaV())).toMatchObject({ kind: "file", can_delete: false });
    expect(pub(awaV())).toMatchObject({ can_delete: true });
    expect(pub(adminV())).toMatchObject({ can_delete: true });
  });

  it("l'adresse de téléchargement passe par la route protégée de la génération", () => {
    const item = buildDownloads(db, awaV(), [])
      .groups.find((g) => g.session_id === "s-awa")
      ?.items.find((i) => i.id === "f-awa");
    expect(item).toMatchObject({
      download_url: "/api/sessions/s-awa/videos/f-awa?download=1",
    });
  });

  it("une génération passée en privé disparaît de la liste d'un autre compte", () => {
    db.prepare(
      "UPDATE session_meta SET visibility = 'private' WHERE id = 's-pub'",
    ).run();
    const out = buildDownloads(db, moussaV(), []);
    expect(out.groups.map((g) => g.session_id)).toEqual(["s-moussa"]);
  });
});

describe("visibilité des exports en file", () => {
  it("un compte voit ses exports ; ceux des autres lui restent cachés, même sur une génération publique", () => {
    const jobs = [
      job({ id: "j-awa", sessionId: "s-pub", userId: awa }),
      job({ id: "j-moussa", sessionId: "s-pub", userId: moussa }),
    ];
    const ids = (viewer: Actor) =>
      buildDownloads(db, viewer, jobs).groups.flatMap((g) =>
        g.items.map((i) => i.id),
      );
    expect(ids(moussaV())).toEqual(["j-moussa"]);
    expect(ids(awaV())).toEqual(["j-awa"]);
    expect(ids(adminV()).sort()).toEqual(["j-awa", "j-moussa"]);
  });

  it("un export sur une génération devenue privée pour son lanceur n'est plus listé", () => {
    db.prepare(
      "UPDATE session_meta SET visibility = 'private' WHERE id = 's-pub'",
    ).run();
    const out = buildDownloads(db, moussaV(), [
      job({ id: "j-moussa", sessionId: "s-pub", userId: moussa }),
    ]);
    expect(out.groups).toEqual([]);
  });

  it("un export dont la génération n'existe plus est ignoré", () => {
    const out = buildDownloads(db, adminV(), [
      job({ id: "j", sessionId: "disparue" }),
    ]);
    expect(out.groups).toEqual([]);
  });

  it("annuler n'est offert qu'au lanceur et à l'administrateur, et seulement tant que l'export est actif", () => {
    const jobs = [
      job({ id: "q", state: "queued" }),
      job({ id: "d", state: "failed", error: "Export annulé." }),
    ];
    const items = (viewer: Actor) =>
      buildDownloads(db, viewer, jobs).groups[0]?.items ?? [];
    const cancel = (viewer: Actor, id: string) =>
      items(viewer).find((i) => i.id === id);
    expect(cancel(awaV(), "q")).toMatchObject({ can_cancel: true });
    expect(cancel(adminV(), "q")).toMatchObject({ can_cancel: true });
    expect(cancel(awaV(), "d")).toMatchObject({ can_cancel: false });
  });
});

describe("statuts et regroupement par génération", () => {
  it("regroupe plusieurs exports d'un même son sous une seule génération", () => {
    file("f1", "s-awa", awa);
    file("f2", "s-awa", awa);
    const out = buildDownloads(db, awaV(), [
      job({ id: "j1", state: "running", ratio: 0.4, progress: "Vidéo 1/2" }),
    ]);
    expect(out.groups).toHaveLength(1);
    expect(out.groups[0]).toMatchObject({
      session_id: "s-awa",
      session_name: "Yusuf",
      active: 1,
    });
    expect(out.groups[0].items.map((i) => i.id).sort()).toEqual([
      "f1",
      "f2",
      "j1",
    ]);
  });

  it("expose le statut, la progression et le message d'échec en français", () => {
    const out = buildDownloads(db, awaV(), [
      job({ id: "run", state: "running", ratio: 0.64, progress: "Vidéo 2/5" }),
      job({ id: "ko", state: "failed", error: "Aucune vidéo produite." }),
    ]);
    const by = (id: string) => out.groups[0].items.find((i) => i.id === id);
    expect(by("run")).toMatchObject({
      kind: "job",
      state: "running",
      ratio: 0.64,
      progress: "Vidéo 2/5",
    });
    expect(by("ko")).toMatchObject({
      state: "failed",
      error: "Aucune vidéo produite.",
    });
  });

  it("les générations avec un export actif passent en tête, puis les plus récentes", () => {
    file("old", "s-pub", awa, 1, "2026-11-01T00:00:00.000Z");
    file("new", "s-awa", awa, 1, "2026-11-09T00:00:00.000Z");
    const out = buildDownloads(db, awaV(), [
      job({ id: "j", sessionId: "s-pub", state: "running" }),
    ]);
    expect(out.groups.map((g) => g.session_id)).toEqual(["s-pub", "s-awa"]);
    expect(out.active).toBe(1);
  });

  it("un export terminé déjà gardé dans les fichiers n'est pas listé deux fois", () => {
    file("kept", "s-awa", awa, 1, "2026-11-10T10:05:00.000Z");
    const out = buildDownloads(db, awaV(), [
      job({
        id: "done",
        state: "done",
        files_done: 1,
        finishedAt: "2026-11-10T10:05:00.000Z",
        download: "file",
        downloads: [{ index: 0, name: "kept.mp4", url: "file" }],
      }),
    ]);
    expect(out.groups[0].items.map((i) => i.id)).toEqual(["kept"]);
  });

  it("un export terminé non gardé (espace plein) reste téléchargeable depuis sa file", () => {
    const out = buildDownloads(db, awaV(), [
      job({
        id: "done",
        state: "done",
        files_done: 1,
        download: "file",
        downloads: [
          { index: 0, name: "a.mp4", url: "file" },
          { index: 1, name: "b.mp4", url: "file?index=1" },
        ],
      }),
    ]);
    expect(out.groups[0].items[0]).toMatchObject({
      kind: "job",
      state: "done",
      downloads: [
        {
          name: "a.mp4",
          url: "/api/sessions/s-awa/export/video/jobs/done/file",
        },
        {
          name: "b.mp4",
          url: "/api/sessions/s-awa/export/video/jobs/done/file?index=1",
        },
      ],
    });
  });

  it("totalise les octets des fichiers visibles", () => {
    file("a", "s-awa", awa, 300);
    file("b", "s-pub", awa, 200);
    expect(buildDownloads(db, awaV(), []).total_bytes).toBe(500);
  });
});
