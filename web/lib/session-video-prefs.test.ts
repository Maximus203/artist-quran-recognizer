import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db";
import { DEFAULT_VIDEO_PREFS } from "./export-video-prefs";
import { createMeta } from "./session-index";
import {
  deleteSessionVideoPrefs,
  readSessionVideoPrefs,
  writeSessionVideoPrefs,
} from "./session-video-prefs";
import { createUser } from "./users";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
let db: Db;
let awa: number;
let bakary: number;

const meta = (id: string, ownerId: number) =>
  createMeta(db, {
    id,
    name: id,
    nameSource: "auto",
    originalName: "x.mp3",
    sourceKind: "file",
    visibility: "global",
    state: "ready",
    sizeBytes: 1,
    ownerId,
    createdAt: "2026-11-01T00:00:00.000Z",
  });

beforeEach(() => {
  db = openDatabase(":memory:");
  awa = createUser(db, { username: "awa", passwordHash: "x" }).id;
  bakary = createUser(db, { username: "bakary", passwordHash: "x" }).id;
  meta(A, awa);
  meta(B, awa);
});
afterEach(() => db.close());

const noTranslation = { ...DEFAULT_VIDEO_PREFS, showTranslation: false };
const arabicOnly = {
  ...DEFAULT_VIDEO_PREFS,
  showTranslation: false,
  showWave: false,
};

describe("réglages d'export par vidéo : magasin", () => {
  it("rend null pour une vidéo jamais personnalisée", () => {
    expect(readSessionVideoPrefs(db, awa, A)).toBeNull();
  });

  it("garde chaque vidéo à part : A ne fuit jamais vers B", () => {
    writeSessionVideoPrefs(db, awa, A, noTranslation);
    writeSessionVideoPrefs(db, awa, B, arabicOnly);
    expect(readSessionVideoPrefs(db, awa, A)?.prefs).toEqual(noTranslation);
    expect(readSessionVideoPrefs(db, awa, B)?.prefs).toEqual(arabicOnly);
  });

  it("remplace la valeur précédente d'une même vidéo (une ligne, horodatée)", () => {
    writeSessionVideoPrefs(
      db,
      awa,
      A,
      noTranslation,
      "2026-11-02T00:00:00.000Z",
    );
    writeSessionVideoPrefs(db, awa, A, arabicOnly, "2026-11-03T00:00:00.000Z");
    const row = readSessionVideoPrefs(db, awa, A);
    expect(row?.prefs).toEqual(arabicOnly);
    expect(row?.updated_at).toBe("2026-11-03T00:00:00.000Z");
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM session_video_prefs").get(),
    ).toEqual({ n: 1 });
  });

  it("sépare les comptes : les réglages de awa ne sont pas ceux de bakary", () => {
    writeSessionVideoPrefs(db, awa, A, noTranslation);
    expect(readSessionVideoPrefs(db, bakary, A)).toBeNull();
    writeSessionVideoPrefs(db, bakary, A, arabicOnly);
    expect(readSessionVideoPrefs(db, awa, A)?.prefs).toEqual(noTranslation);
  });

  it("refuse (sans rien écrire) des réglages invalides", () => {
    expect(() =>
      writeSessionVideoPrefs(db, awa, A, {
        ...DEFAULT_VIDEO_PREFS,
        orientation: "4:3",
      } as never),
    ).toThrow();
    expect(() =>
      writeSessionVideoPrefs(db, awa, A, {
        ...DEFAULT_VIDEO_PREFS,
        injected: 1,
      } as never),
    ).toThrow();
    expect(readSessionVideoPrefs(db, awa, A)).toBeNull();
  });

  it("récupère champ par champ une ligne abîmée au lieu de la perdre", () => {
    db.prepare(
      "INSERT INTO session_video_prefs (user_id, session_id, prefs, updated_at) VALUES (?, ?, ?, ?)",
    ).run(
      awa,
      A,
      JSON.stringify({ ...noTranslation, resolution: 12 }),
      "2026-11-02T00:00:00.000Z",
    );
    const row = readSessionVideoPrefs(db, awa, A);
    expect(row?.prefs.showTranslation).toBe(false);
    expect(row?.prefs.resolution).toBe(DEFAULT_VIDEO_PREFS.resolution);
  });

  it("une ligne illisible vaut « jamais personnalisée »", () => {
    db.prepare(
      "INSERT INTO session_video_prefs (user_id, session_id, prefs, updated_at) VALUES (?, ?, ?, ?)",
    ).run(awa, A, "{pas du json", "2026-11-02T00:00:00.000Z");
    expect(readSessionVideoPrefs(db, awa, A)).toBeNull();
  });

  it("delete remet une vidéo à son point de départ, sans toucher aux autres", () => {
    writeSessionVideoPrefs(db, awa, A, noTranslation);
    writeSessionVideoPrefs(db, awa, B, arabicOnly);
    deleteSessionVideoPrefs(db, awa, A);
    expect(readSessionVideoPrefs(db, awa, A)).toBeNull();
    expect(readSessionVideoPrefs(db, awa, B)?.prefs).toEqual(arabicOnly);
  });

  it("supprimer la session supprime ses réglages (cascade)", () => {
    writeSessionVideoPrefs(db, awa, A, noTranslation);
    db.prepare("DELETE FROM session_meta WHERE id = ?").run(A);
    expect(readSessionVideoPrefs(db, awa, A)).toBeNull();
  });
});
