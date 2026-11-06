import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exportSummary,
  forgetExport,
  listFiles,
  markExportsSeen,
  recordExport,
} from "./export-index";
import { openDatabase, type Db } from "./db";
import { createUser } from "./users";

let db: Db;
let cherif: number;
let awa: number;

beforeEach(() => {
  db = openDatabase(":memory:");
  cherif = createUser(db, { username: "Cherif", passwordHash: "x" }).id;
  awa = createUser(db, { username: "Awa", passwordHash: "x" }).id;
  db.prepare(
    `INSERT INTO session_meta (id, owner_id, name, original_name, created_at, updated_at)
     VALUES ('s1', ?, 'Yusuf', 'yusuf.mp3', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
  ).run(cherif);
});
afterEach(() => db.close());

const export_ = (id: string, ownerId: number | null) => ({
  id,
  sessionId: "s1",
  ownerId,
  name: `${id}.mp4`,
  bytes: 1000,
  createdAt: "2026-11-01T10:00:00.000Z",
});

describe("index des exports vidéo", () => {
  it("compte tous les exports de la session et les nouveaux pour le lanceur", () => {
    recordExport(db, export_("a", awa));
    recordExport(db, export_("b", cherif));
    expect(exportSummary(db, "s1", awa)).toEqual({ total: 2, new: 1 });
    expect(exportSummary(db, "s1", cherif)).toEqual({ total: 2, new: 1 });
  });

  it("marquer vu retire les nouveaux de celui qui les a ouverts, sans toucher aux autres", () => {
    recordExport(db, export_("a", awa));
    recordExport(db, export_("b", cherif));
    markExportsSeen(db, "s1", awa, "2026-11-01T12:00:00.000Z");
    expect(exportSummary(db, "s1", awa)).toEqual({ total: 2, new: 0 });
    expect(exportSummary(db, "s1", cherif)).toEqual({ total: 2, new: 1 });
  });

  it("supprimer une vidéo la retire du compte", () => {
    recordExport(db, export_("a", awa));
    forgetExport(db, "a");
    expect(exportSummary(db, "s1", awa)).toEqual({ total: 0, new: 0 });
  });

  it("supprimer la session supprime ses exports (cascade)", () => {
    recordExport(db, export_("a", awa));
    db.prepare("DELETE FROM session_meta WHERE id = 's1'").run();
    expect(exportSummary(db, "s1", awa)).toEqual({ total: 0, new: 0 });
  });
});

describe("inventaire des fichiers téléchargeables", () => {
  beforeEach(() => {
    db.prepare(
      `INSERT INTO session_meta (id, owner_id, name, original_name, created_at, updated_at)
       VALUES ('s2', ?, 'Maryam', 'maryam.mp3', '2026-10-02T00:00:00.000Z', '2026-10-02T00:00:00.000Z')`,
    ).run(awa);
    recordExport(db, { ...export_("a", cherif), bytes: 300 });
    recordExport(db, {
      ...export_("b", cherif),
      bytes: 900,
      createdAt: "2026-11-02T10:00:00.000Z",
    });
    recordExport(db, { ...export_("c", awa), sessionId: "s2", bytes: 500 });
  });

  it("un compte ne voit que les fichiers de ses propres sessions, le plus gros d'abord", () => {
    const mine = listFiles(db, { id: cherif, role: "user" });
    expect(mine.map((f) => f.id)).toEqual(["b", "a"]);
    expect(mine[0]).toMatchObject({
      sessionId: "s1",
      sessionName: "Yusuf",
      ownerName: "Cherif",
      bytes: 900,
    });
  });

  it("une vidéo lancée par un autre sur ma session est dans mon inventaire (c'est mon espace)", () => {
    recordExport(db, { ...export_("d", awa), bytes: 100 });
    expect(
      listFiles(db, { id: cherif, role: "user" }).map((f) => f.id),
    ).toContain("d");
    expect(listFiles(db, { id: awa, role: "user" }).map((f) => f.id)).toEqual([
      "c",
    ]);
  });

  it("l'administrateur voit tous les fichiers, avec leur propriétaire", () => {
    const admin = createUser(db, { username: "Root", passwordHash: "x" }).id;
    db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin);
    const all = listFiles(db, { id: admin, role: "admin" });
    expect(all.map((f) => f.id)).toEqual(["b", "c", "a"]);
    expect(all.find((f) => f.id === "c")?.ownerName).toBe("Awa");
  });

  it("un compte sans fichier reçoit une liste vide", () => {
    const nobody = createUser(db, { username: "Zoe", passwordHash: "x" }).id;
    expect(listFiles(db, { id: nobody, role: "user" })).toEqual([]);
  });
});
