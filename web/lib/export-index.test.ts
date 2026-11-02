import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exportSummary,
  forgetExport,
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
