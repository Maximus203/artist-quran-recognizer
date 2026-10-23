import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db";
import {
  createMeta,
  deleteMeta,
  getMeta,
  listCounts,
  listPage,
  markViewedBy,
  recordAnalysis,
  setFavorite,
  syncMirror,
  updateMeta,
  usedBytes,
  userAnalysisStats,
  viewState,
  type NewMeta,
} from "./session-index";
import { parseListQuery, type ListQuery } from "./session-query";
import type { Session } from "./store";
import { createUser } from "./users";

let db: Db;
let cherif: number;
let awa: number;

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function add(n: number, extra: Partial<NewMeta> = {}) {
  createMeta(db, {
    id: id(n),
    ownerId: cherif,
    name: `Session ${n}`,
    nameSource: "auto",
    originalName: `fichier${n}.mp3`,
    sourceKind: "file",
    visibility: "global",
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
    sizeBytes: n * 1000,
    ...extra,
  });
}

const query = (qs: string, overrides: Partial<ListQuery> = {}): ListQuery => {
  const parsed = parseListQuery(new URLSearchParams(qs));
  if (!parsed.ok) throw new Error(parsed.message);
  return { ...parsed.query, ...overrides };
};

const session = (n: number, patch: Partial<Session> = {}): Session => ({
  id: id(n),
  name: `fichier${n}.mp3`,
  extension: ".mp3",
  audio_sha256: "a".repeat(64),
  size: n * 1000,
  created_at: new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString(),
  state: "ready",
  error: null,
  started_at: null,
  finished_at: null,
  prediction_sha256: null,
  pid: null,
  ...patch,
});

beforeEach(() => {
  db = openDatabase(":memory:");
  cherif = createUser(db, { username: "Cherif", passwordHash: "x" }).id;
  awa = createUser(db, { username: "Awa", passwordHash: "x" }).id;
});
afterEach(() => db.close());

const ids = (rows: Array<{ id: string }>) =>
  rows.map((r) => Number(r.id.slice(-12)));

describe("propriétaire affiché : pseudo et empreinte de la photo", () => {
  it("chaque ligne porte le pseudo et l'empreinte de la photo de son propriétaire", () => {
    add(1); // Cherif, sans photo
    add(2, { ownerId: awa });
    add(3, { ownerId: null });
    db.prepare("UPDATE users SET avatar_hash = ? WHERE id = ?").run(
      "abcdef0123456789",
      awa,
    );
    const rows = listPage(db, cherif, query("scope=all")).items;
    const by = (n: number) => rows.find((r) => r.id === id(n))!;
    expect(by(1)).toMatchObject({ owner_name: "Cherif", owner_avatar: null });
    expect(by(2)).toMatchObject({
      owner_name: "Awa",
      owner_avatar: "abcdef0123456789",
    });
    expect(by(3)).toMatchObject({ owner_name: null, owner_avatar: null });
    expect(getMeta(db, id(2))!.owner_avatar).toBe("abcdef0123456789");
  });

  it("changer la photo se voit aussitôt dans la liste", () => {
    add(1, { ownerId: awa });
    db.prepare("UPDATE users SET avatar_hash = 'v1' WHERE id = ?").run(awa);
    expect(listPage(db, cherif, query("")).items[0].owner_avatar).toBe("v1");
    db.prepare("UPDATE users SET avatar_hash = 'v2' WHERE id = ?").run(awa);
    expect(listPage(db, cherif, query("")).items[0].owner_avatar).toBe("v2");
    db.prepare("UPDATE users SET avatar_hash = NULL WHERE id = ?").run(awa);
    expect(listPage(db, cherif, query("")).items[0].owner_avatar).toBeNull();
  });

  it("une session privée reste invisible des autres, photo ou non (règle inchangée)", () => {
    add(1, { ownerId: awa, visibility: "private" });
    db.prepare("UPDATE users SET avatar_hash = 'v1' WHERE id = ?").run(awa);
    expect(listPage(db, cherif, query("scope=all")).items).toHaveLength(0);
    expect(listPage(db, awa, query("scope=all")).items).toHaveLength(1);
  });
});

describe("portées et visibilité", () => {
  beforeEach(() => {
    add(1); // global, Cherif
    add(2, { visibility: "private" }); // privé, Cherif
    add(3, { ownerId: awa }); // global, Awa
    add(4, { ownerId: awa, visibility: "private" }); // privé, Awa
    add(5, { ownerId: null }); // global, d'avant les comptes
  });

  it("all : mes sessions + les globales, jamais le privé d'un autre", () => {
    expect(ids(listPage(db, cherif, query("scope=all")).items).sort()).toEqual([
      1, 2, 3, 5,
    ]);
    expect(ids(listPage(db, awa, query("scope=all")).items).sort()).toEqual([
      1, 3, 4, 5,
    ]);
  });

  it("mine : seulement les miennes, privées comprises", () => {
    expect(ids(listPage(db, cherif, query("scope=mine")).items).sort()).toEqual(
      [1, 2],
    );
  });

  it("shared : les globales des autres (et d'avant les comptes)", () => {
    expect(
      ids(listPage(db, cherif, query("scope=shared")).items).sort(),
    ).toEqual([3, 5]);
    expect(ids(listPage(db, awa, query("scope=shared")).items).sort()).toEqual([
      1, 5,
    ]);
  });

  it("favorites : mes favoris visibles, par utilisateur", () => {
    setFavorite(db, cherif, id(1), true, "now");
    setFavorite(db, cherif, id(3), true, "now");
    setFavorite(db, awa, id(1), true, "now");
    expect(
      ids(listPage(db, cherif, query("scope=favorites")).items).sort(),
    ).toEqual([1, 3]);
    expect(ids(listPage(db, awa, query("scope=favorites")).items)).toEqual([1]);
    expect(
      listPage(db, awa, query("scope=all")).items.find((r) => r.id === id(1))
        ?.favorite,
    ).toBe(true);
    expect(
      listPage(db, awa, query("scope=all")).items.find((r) => r.id === id(3))
        ?.favorite,
    ).toBe(false);
  });

  it("un favori sur une session devenue privée disparaît de la liste de l'autre", () => {
    setFavorite(db, awa, id(1), true, "now");
    updateMeta(db, id(1), { visibility: "private" }, "now");
    expect(ids(listPage(db, awa, query("scope=favorites")).items)).toEqual([]);
  });

  it("archived : retire la session des autres portées", () => {
    updateMeta(db, id(1), { archivedAt: "2026-10-02T00:00:00.000Z" }, "now");
    expect(ids(listPage(db, cherif, query("scope=archived")).items)).toEqual([
      1,
    ]);
    expect(ids(listPage(db, cherif, query("scope=all")).items)).not.toContain(
      1,
    );
    expect(ids(listPage(db, awa, query("scope=archived")).items)).toEqual([1]);
    // L'archive d'un privé ne fuit pas.
    updateMeta(db, id(2), { archivedAt: "2026-10-02T00:00:00.000Z" }, "now");
    expect(ids(listPage(db, awa, query("scope=archived")).items)).toEqual([1]);
  });

  it("aucun filtre ne contourne la visibilité (recherche, états, curseur)", () => {
    expect(
      ids(listPage(db, cherif, query("scope=all&q=session 4")).items),
    ).toEqual([]);
    expect(
      ids(listPage(db, cherif, query("scope=all&state=ready&limit=100")).items),
    ).not.toContain(4);
  });
});

describe("filtres", () => {
  beforeEach(() => {
    add(1, { name: "Récitation Yusuf", originalName: "yusuf.mp3" });
    add(2, { name: "Test micro", sourceKind: "microphone" });
    add(3, { name: "Al-Baqara" });
    syncMirror(
      db,
      session(1, {
        state: "done",
        engine: "cascade",
        started_at: "2026-10-01T00:00:00.000Z",
        finished_at: "2026-10-01T00:05:00.000Z",
        audio_duration_s: 60,
      }),
      "now",
    );
    syncMirror(
      db,
      session(2, { state: "running", engine: "fastconformer" }),
      "now",
    );
    syncMirror(db, session(3, { state: "queued" }), "now");
  });

  it("recherche insensible à la casse et aux accents, tous les mots", () => {
    expect(ids(listPage(db, cherif, query("q=recitation")).items)).toEqual([1]);
    expect(ids(listPage(db, cherif, query("q=YUSUF recit")).items)).toEqual([
      1,
    ]);
    expect(ids(listPage(db, cherif, query("q=baqara")).items)).toEqual([3]);
    expect(ids(listPage(db, cherif, query("q=yusuf micro")).items)).toEqual([]);
  });

  it("la recherche traite % et _ comme des caractères ordinaires", () => {
    expect(listPage(db, cherif, query("q=%25")).items).toHaveLength(0);
    expect(listPage(db, cherif, query("q=_")).items).toHaveLength(0);
  });

  it("injection SQL via la recherche : sans effet", () => {
    expect(listPage(db, cherif, query("q=' OR 1=1 --")).items).toHaveLength(0);
    expect(
      listPage(db, cherif, query("q=a'); DROP TABLE session_meta;--")).items,
    ).toHaveLength(0);
    expect(listPage(db, cherif, query("scope=all")).items).toHaveLength(3);
  });

  it("état, plusieurs états, actif", () => {
    expect(ids(listPage(db, cherif, query("state=done")).items)).toEqual([1]);
    expect(
      ids(listPage(db, cherif, query("state=done,running")).items).sort(),
    ).toEqual([1, 2]);
    expect(
      ids(listPage(db, cherif, query("state=active")).items).sort(),
    ).toEqual([2, 3]);
  });

  it("moteur et dates (jour inclus)", () => {
    expect(ids(listPage(db, cherif, query("engine=cascade")).items)).toEqual([
      1,
    ]);
    expect(
      listPage(db, cherif, query("from=2026-10-01&to=2026-10-01")).items,
    ).toHaveLength(3);
    expect(listPage(db, cherif, query("from=2026-10-02")).items).toHaveLength(
      0,
    );
    expect(listPage(db, cherif, query("to=2026-09-30")).items).toHaveLength(0);
    expect(
      ids(listPage(db, cherif, query("from=2026-10-01T00:02:00Z")).items),
    ).toEqual([3, 2]);
  });
});

describe("non lu par utilisateur", () => {
  it("seul le propriétaire voit « non lu », jusqu'à l'ouverture", () => {
    add(1);
    syncMirror(
      db,
      session(1, { state: "done", finished_at: "2026-10-01T00:05:00.000Z" }),
      "now",
    );
    expect(viewState(db, cherif, id(1)).unread).toBe(true);
    expect(viewState(db, awa, id(1)).unread).toBe(false);
    expect(listPage(db, cherif, query("state=unread")).items).toHaveLength(1);
    expect(listPage(db, awa, query("state=unread")).items).toHaveLength(0);
    markViewedBy(db, cherif, id(1), "2026-10-01T01:00:00.000Z");
    expect(viewState(db, cherif, id(1)).unread).toBe(false);
    expect(listCounts(db, cherif, query("")).states.unread).toBe(0);
  });

  it("une session qui n'est pas terminée n'est pas non lue", () => {
    add(1);
    expect(viewState(db, cherif, id(1)).unread).toBe(false);
  });

  it("une nouvelle fin d'analyse redevient non lue", () => {
    add(1);
    syncMirror(
      db,
      session(1, { state: "failed", finished_at: "2026-10-01T00:05:00.000Z" }),
      "now",
    );
    markViewedBy(db, cherif, id(1), "2026-10-01T01:00:00.000Z");
    syncMirror(
      db,
      session(1, { state: "done", finished_at: "2026-10-01T02:00:00.000Z" }),
      "now",
    );
    expect(viewState(db, cherif, id(1)).unread).toBe(true);
  });
});

describe("pagination par curseur (keyset)", () => {
  const SORTS = ["recent", "oldest", "name", "duration", "size"] as const;

  beforeEach(() => {
    for (let n = 1; n <= 23; n++) {
      // Égalités volontaires : durées et tailles identiques par paquets, noms en double.
      add(n, { name: `Nom ${n % 5}`, sizeBytes: (n % 4) * 100 });
      syncMirror(
        db,
        session(n, {
          audio_duration_s: n % 3 === 0 ? null : (n % 6) * 10,
          size: (n % 4) * 100,
        }),
        "now",
      );
    }
  });

  for (const sort of SORTS)
    it(`tri « ${sort} » : toutes les pages, sans doublon ni trou`, () => {
      const all = ids(
        listPage(db, cherif, query(`sort=${sort}&limit=100`)).items,
      );
      expect(all).toHaveLength(23);
      const seen: number[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const page = listPage(
          db,
          cherif,
          query(`sort=${sort}&limit=5${cursor ? `&cursor=${cursor}` : ""}`),
        );
        seen.push(...ids(page.items));
        expect(page.total).toBe(23);
        cursor = page.next_cursor;
        pages += 1;
      } while (cursor && pages < 20);
      expect(pages).toBe(5);
      expect(seen).toEqual(all);
    });

  it("reste stable quand une session arrive entre deux pages", () => {
    const first = listPage(db, cherif, query("sort=recent&limit=10"));
    add(99, { createdAt: "2026-11-01T00:00:00.000Z" }); // plus récente : passe devant, hors des pages suivantes
    const second = listPage(
      db,
      cherif,
      query(`sort=recent&limit=10&cursor=${first.next_cursor}`),
    );
    expect(
      ids(second.items).filter((n) => ids(first.items).includes(n)),
    ).toEqual([]);
    expect(ids(second.items)).not.toContain(99);
  });

  it("refuse un curseur forgé, tronqué ou issu d'un autre tri", () => {
    const first = listPage(db, cherif, query("sort=recent&limit=2"));
    const cursor = first.next_cursor as string;
    for (const bad of [
      "zzz",
      "e30",
      Buffer.from('{"sort":"recent"}').toString("base64url"),
    ])
      expect(parseListQuery(new URLSearchParams(`cursor=${bad}`)).ok).toBe(
        false,
      );
    expect(
      parseListQuery(new URLSearchParams(`sort=name&cursor=${cursor}`)).ok,
    ).toBe(false);
    expect(
      parseListQuery(new URLSearchParams(`sort=recent&cursor=${cursor}`)).ok,
    ).toBe(true);
  });

  it("un curseur au contenu piégé reste inoffensif (paramètres liés)", () => {
    const evil = Buffer.from(
      JSON.stringify({ sort: "recent", value: "x' OR '1'='1", id: "a') --" }),
    ).toString("base64url");
    const page = listPage(
      db,
      cherif,
      query(`sort=recent&limit=100&cursor=${evil}`),
    );
    expect(page.items.length).toBeLessThanOrEqual(23);
  });
});

describe("paramètres d'URL", () => {
  const bad = (qs: string) => {
    const parsed = parseListQuery(new URLSearchParams(qs));
    return parsed.ok ? null : parsed.message;
  };
  it("refuse ce qui est invalide, avec un message", () => {
    for (const qs of [
      "scope=tout",
      "sort=aleatoire",
      "state=perdu",
      "engine=gpt",
      "limit=0",
      "limit=101",
      "limit=abc",
      "from=hier",
      `q=${"x".repeat(101)}`,
    ])
      expect(bad(qs), qs).toBeTruthy();
  });
  it("applique les défauts : portée all, 20 par page, plus récentes d'abord", () => {
    const parsed = parseListQuery(new URLSearchParams(""));
    expect(parsed.ok && parsed.query).toMatchObject({
      scope: "all",
      limit: 20,
      sort: "recent",
      states: [],
    });
  });
});

describe("compteurs", () => {
  it("par portée et par état, filtres appliqués", () => {
    add(1);
    add(2, { visibility: "private" });
    add(3, { ownerId: awa, name: "Autre" });
    add(4, { ownerId: awa, visibility: "private" });
    syncMirror(
      db,
      session(1, { state: "done", finished_at: "2026-10-01T00:05:00.000Z" }),
      "now",
    );
    syncMirror(db, session(3, { state: "running" }), "now");
    updateMeta(db, id(2), { archivedAt: "2026-10-05T00:00:00.000Z" }, "now");
    const counts = listCounts(db, cherif, query("scope=all"));
    expect(counts.scopes).toEqual({
      mine: 1,
      shared: 1,
      all: 2,
      favorites: 0,
      archived: 1,
    });
    expect(counts.states).toMatchObject({
      total: 2,
      done: 1,
      running: 1,
      ready: 0,
      active: 1,
      unread: 1,
    });
    expect(listCounts(db, cherif, query("scope=all&q=autre")).scopes.all).toBe(
      1,
    );
  });
});

describe("mirroir, quota et journal", () => {
  it("createMeta ne remplace jamais une ligne existante (propriété intacte)", () => {
    add(1, { ownerId: awa, visibility: "private" });
    add(1, { ownerId: cherif, visibility: "global" });
    expect(getMeta(db, id(1))).toMatchObject({
      owner_id: awa,
      visibility: "private",
    });
  });

  it("syncMirror recopie l'état sans toucher propriétaire, nom ni portée", () => {
    add(1, { ownerId: awa, visibility: "private" });
    updateMeta(db, id(1), { name: "Mon nom", nameSource: "user" }, "now");
    syncMirror(
      db,
      session(1, { state: "done", engine: "whisper", audio_duration_s: 42 }),
      "now",
    );
    expect(getMeta(db, id(1))).toMatchObject({
      owner_id: awa,
      visibility: "private",
      name: "Mon nom",
      name_source: "user",
      state: "done",
      engine: "whisper",
      audio_duration_s: 42,
    });
  });

  it("le renommage est retrouvé par la recherche et le tri par nom", () => {
    add(1);
    updateMeta(db, id(1), { name: "Écoute Ñandú" }, "now");
    expect(listPage(db, cherif, query("q=nandu")).items).toHaveLength(1);
  });

  it("quota : somme des octets envoyés par propriétaire", () => {
    add(1);
    add(2);
    add(3, { ownerId: awa });
    expect(usedBytes(db, cherif)).toBe(3000);
    expect(usedBytes(db, awa)).toBe(3000);
    deleteMeta(db, id(1));
    expect(usedBytes(db, cherif)).toBe(2000);
  });

  it("journal des analyses : idempotent, survit à la suppression de la session", () => {
    add(1);
    const done = session(1, {
      state: "done",
      engine: "cascade",
      started_at: "2026-10-01T00:00:00.000Z",
      finished_at: "2026-10-01T00:01:00.000Z",
      audio_duration_s: 120,
      duration_s: 30,
    });
    recordAnalysis(db, done, cherif);
    recordAnalysis(db, done, cherif);
    recordAnalysis(db, session(1, { state: "ready" }), cherif); // pas terminée : ignorée
    // Un résultat importé à la main n'est pas une analyse.
    recordAnalysis(db, session(2, { state: "done", started_at: null }), cherif);
    deleteMeta(db, id(1));
    const stats = userAnalysisStats(db, cherif);
    expect(stats).toMatchObject({
      tests: 1,
      failures: 0,
      audio_total_s: 120,
      processing_total_s: 30,
      rtf_mean: 0.25,
    });
    expect(stats.by_engine).toEqual([{ engine: "cascade", tests: 1 }]);
    expect(userAnalysisStats(db, awa).tests).toBe(0);
  });
});
