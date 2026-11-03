import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "./access";
import { openDatabase, type Db } from "./db";
import {
  MAX_ITEMS,
  MAX_PLAYLISTS,
  PlaylistFullError,
  PlaylistLimitError,
  addToPlaylist,
  cleanPlaylistName,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  removeFromPlaylist,
  renamePlaylist,
  reorderPlaylist,
} from "./playlists";
import { createUser, deleteUser } from "./users";

/** Playlists : un compte regroupe des audios qu'il peut voir, et les lit à la suite. */
let db: Db;
let me: Actor;
let other: Actor;
let admin: Actor;
const T = "2026-11-03T14:00:00.000Z";

const session = (
  id: string,
  owner: number,
  visibility: "global" | "private" = "global",
  duration = 10,
) =>
  db
    .prepare(
      `INSERT INTO session_meta (id, owner_id, name, original_name, visibility, created_at, updated_at, audio_duration_s, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done')`,
    )
    .run(id, owner, `Audio ${id}`, `${id}.wav`, visibility, T, T, duration);

const count = (table: string, where = "1 = 1") =>
  (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as {
      n: number;
    }
  ).n;

beforeEach(() => {
  db = openDatabase(":memory:");
  const a = createUser(db, { username: "Cherif", passwordHash: "x" });
  const m = createUser(db, { username: "Awa", passwordHash: "x" });
  const o = createUser(db, { username: "Moussa", passwordHash: "x" });
  admin = { id: a.id, role: "admin" };
  me = { id: m.id, role: "user" };
  other = { id: o.id, role: "user" };
  session("s1", me.id);
  session("s2", me.id);
  session("s3", other.id);
  session("secret", other.id, "private");
});
afterEach(() => db.close());

const ids = (playlistId: number, actor = me) =>
  getPlaylist(db, playlistId, actor)?.items.map((i) => i.session_id);

describe("noms", () => {
  it("1 à 60 caractères, espaces repliés", () => {
    expect(cleanPlaylistName("  Sourate   Yusuf ")).toBe("Sourate Yusuf");
    expect(cleanPlaylistName("")).toBeNull();
    expect(cleanPlaylistName("x".repeat(61))).toBeNull();
    expect(cleanPlaylistName(5)).toBeNull();
  });
});

describe("création et liste", () => {
  it("crée une playlist vide ; la liste donne le nombre et la durée", () => {
    const p = createPlaylist(db, me.id, "Révision", T);
    addToPlaylist(db, p.id, me, ["s1", "s2"], T);
    expect(listPlaylists(db, me)).toEqual([
      expect.objectContaining({ name: "Révision", count: 2, duration_s: 20 }),
    ]);
    expect(listPlaylists(db, other)).toEqual([]);
  });

  it(`plafonne à ${MAX_PLAYLISTS} playlists par compte`, () => {
    for (let i = 0; i < MAX_PLAYLISTS; i++)
      createPlaylist(db, me.id, `P${i}`, T);
    expect(() => createPlaylist(db, me.id, "de trop", T)).toThrow(
      PlaylistLimitError,
    );
    expect(() => createPlaylist(db, other.id, "autre", T)).not.toThrow();
  });
});

describe("propriété", () => {
  it("une playlist n'est lisible, modifiable et supprimable que par son propriétaire (admin compris)", () => {
    const p = createPlaylist(db, me.id, "À moi", T);
    expect(getPlaylist(db, p.id, other)).toBeNull();
    expect(getPlaylist(db, p.id, admin)).toBeNull();
    expect(renamePlaylist(db, p.id, other.id, "Volée", T)).toBe(false);
    expect(deletePlaylist(db, p.id, other.id)).toBe(false);
    expect(addToPlaylist(db, p.id, other, ["s3"], T)).toBeNull();
    expect(getPlaylist(db, p.id, me)?.name).toBe("À moi");
  });
});

describe("contenu", () => {
  it("ajoute à la suite, sans doublon, et ignore une session inconnue", () => {
    const p = createPlaylist(db, me.id, "P", T);
    expect(addToPlaylist(db, p.id, me, ["s1", "s3", "nope"], T)).toEqual({
      added: 2,
      skipped: 1,
    });
    expect(addToPlaylist(db, p.id, me, ["s1", "s2"], T)).toEqual({
      added: 1,
      skipped: 1,
    });
    expect(ids(p.id)).toEqual(["s1", "s3", "s2"]);
  });

  it("n'ajoute pas l'audio privé d'un autre ; l'administrateur, qui voit tout, le peut", () => {
    const p = createPlaylist(db, me.id, "P", T);
    expect(addToPlaylist(db, p.id, me, ["secret"], T)).toEqual({
      added: 0,
      skipped: 1,
    });
    const q = createPlaylist(db, admin.id, "Q", T);
    expect(addToPlaylist(db, q.id, admin, ["secret"], T)?.added).toBe(1);
  });

  it("une session devenue invisible disparaît de la lecture, sans être perdue", () => {
    const p = createPlaylist(db, me.id, "P", T);
    addToPlaylist(db, p.id, me, ["s1", "s3"], T);
    db.prepare(
      "UPDATE session_meta SET visibility = 'private' WHERE id = 's3'",
    ).run();
    expect(ids(p.id)).toEqual(["s1"]);
    db.prepare(
      "UPDATE session_meta SET visibility = 'global' WHERE id = 's3'",
    ).run();
    expect(ids(p.id)).toEqual(["s1", "s3"]);
  });

  it("une session supprimée sort de la playlist", () => {
    const p = createPlaylist(db, me.id, "P", T);
    addToPlaylist(db, p.id, me, ["s1", "s2"], T);
    db.prepare("DELETE FROM session_meta WHERE id = 's1'").run();
    expect(ids(p.id)).toEqual(["s2"]);
  });

  it(`plafonne à ${MAX_ITEMS} audios`, () => {
    const p = createPlaylist(db, me.id, "Pleine", T);
    const many = Array.from({ length: MAX_ITEMS }, (_, i) => `m${i}`);
    for (const id of many) session(id, me.id);
    addToPlaylist(db, p.id, me, many, T);
    expect(() => addToPlaylist(db, p.id, me, ["s1"], T)).toThrow(
      PlaylistFullError,
    );
  });

  it("retire un audio et referme les positions", () => {
    const p = createPlaylist(db, me.id, "P", T);
    addToPlaylist(db, p.id, me, ["s1", "s2", "s3"], T);
    expect(removeFromPlaylist(db, p.id, me.id, "s2", T)).toBe(true);
    expect(removeFromPlaylist(db, p.id, me.id, "s2", T)).toBe(false);
    expect(getPlaylist(db, p.id, me)?.items.map((i) => i.position)).toEqual([
      0, 1,
    ]);
    expect(ids(p.id)).toEqual(["s1", "s3"]);
  });
});

describe("ordre", () => {
  it("réordonne : l'ordre fourni doit être exactement celui des audios présents", () => {
    const p = createPlaylist(db, me.id, "P", T);
    addToPlaylist(db, p.id, me, ["s1", "s2", "s3"], T);
    expect(reorderPlaylist(db, p.id, me, ["s3", "s1", "s2"], T)).toBe(true);
    expect(ids(p.id)).toEqual(["s3", "s1", "s2"]);
    expect(reorderPlaylist(db, p.id, me, ["s3", "s1"], T)).toBe(false);
    expect(reorderPlaylist(db, p.id, me, ["s3", "s1", "s1"], T)).toBe(false);
    expect(reorderPlaylist(db, p.id, me, ["s3", "s1", "zz"], T)).toBe(false);
    expect(ids(p.id)).toEqual(["s3", "s1", "s2"]);
  });
});

describe("renommer, supprimer", () => {
  it("renomme et supprime avec ses audios (les sessions restent)", () => {
    const p = createPlaylist(db, me.id, "Vieux nom", T);
    addToPlaylist(db, p.id, me, ["s1"], T);
    expect(renamePlaylist(db, p.id, me.id, "Nouveau", T)).toBe(true);
    expect(getPlaylist(db, p.id, me)?.name).toBe("Nouveau");
    expect(deletePlaylist(db, p.id, me.id)).toBe(true);
    expect(getPlaylist(db, p.id, me)).toBeNull();
    expect(count("playlist_items")).toBe(0);
    expect(count("session_meta", "id = 's1'")).toBe(1);
  });

  it("les playlists disparaissent avec le compte", () => {
    createPlaylist(db, other.id, "Temporaire", T);
    deleteUser(db, other.id, admin.id);
    expect(count("playlists")).toBe(0);
  });
});
