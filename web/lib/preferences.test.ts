import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db";
import {
  PREFERENCE_DEFAULTS,
  PREFERENCE_KEYS,
  patchPreferences,
  preferencesPatchSchema,
  readPreferences,
  resetPreferences,
} from "./preferences";
import { createUser } from "./users";

let db: Db;
let userId: number;
beforeEach(() => {
  db = openDatabase(":memory:");
  userId = createUser(db, { username: "Cherif", passwordHash: "x" }).id;
});
afterEach(() => db.close());

describe("préférences : défauts centralisés", () => {
  it("renvoie les défauts pour un compte neuf, sans horodatage", () => {
    const view = readPreferences(db, userId);
    expect(view.preferences).toEqual(PREFERENCE_DEFAULTS);
    expect(view.updated_at).toEqual({});
    expect(view.defaults).toEqual(PREFERENCE_DEFAULTS);
  });

  it("couvre exactement les clés attendues", () => {
    expect([...PREFERENCE_KEYS].sort()).toEqual(
      [
        "theme",
        "arabicFont",
        "arabicSize",
        "translation",
        "liveHighlight",
        "audioOffsetMs",
        "visibleSpanSeconds",
        "followPlayback",
        "leftPanelOpen",
        "sidebarRecent",
        "rightPanelOpen",
        "sessionsFilter",
        "playbackRate",
        "volume",
        "echo",
        "shortcutsEnabled",
        "reviewTab",
        "defaultVisibility",
        "exportOptions",
        "videoPrefs",
      ].sort(),
    );
  });
});

describe("préférences : fusion partielle", () => {
  it("ne change que les clés fournies, avec un horodatage par clé", () => {
    patchPreferences(db, userId, { theme: "dark" }, "2026-10-22T10:00:00.000Z");
    const view = patchPreferences(
      db,
      userId,
      { volume: 0.4, visibleSpanSeconds: 30 },
      "2026-10-22T11:00:00.000Z",
    );
    expect(view.preferences.theme).toBe("dark");
    expect(view.preferences.volume).toBe(0.4);
    expect(view.preferences.visibleSpanSeconds).toBe(30);
    expect(view.preferences.followPlayback).toBe(true);
    expect(view.updated_at).toEqual({
      theme: "2026-10-22T10:00:00.000Z",
      volume: "2026-10-22T11:00:00.000Z",
      visibleSpanSeconds: "2026-10-22T11:00:00.000Z",
    });
  });

  it("« Surligner en direct » : activé par défaut, enregistré côté serveur par compte", () => {
    expect(readPreferences(db, userId).preferences.liveHighlight).toBe(true);
    const view = patchPreferences(
      db,
      userId,
      { liveHighlight: false },
      "2026-10-22T12:00:00.000Z",
    );
    expect(view.preferences.liveHighlight).toBe(false);
    expect(view.updated_at.liveHighlight).toBe("2026-10-22T12:00:00.000Z");
    const other = createUser(db, { username: "Moussa", passwordHash: "x" }).id;
    expect(readPreferences(db, other).preferences.liveHighlight).toBe(true);
    expect(
      preferencesPatchSchema.safeParse({ liveHighlight: "oui" }).success,
    ).toBe(false);
    expect(
      preferencesPatchSchema.safeParse({ liveHighlight: false }).success,
    ).toBe(true);
  });

  it("« Décalage audio » : 0 par défaut, mémorisé par compte, valeurs hors pas refusées", () => {
    expect(readPreferences(db, userId).preferences.audioOffsetMs).toBe(0);
    const view = patchPreferences(db, userId, { audioOffsetMs: -180 });
    expect(view.preferences.audioOffsetMs).toBe(-180);
    const other = createUser(db, { username: "Fatou", passwordHash: "x" }).id;
    expect(readPreferences(db, other).preferences.audioOffsetMs).toBe(0);
    for (const bad of [-510, 510, 15, 0.5, "100", null])
      expect(
        preferencesPatchSchema.safeParse({ audioOffsetMs: bad }).success,
      ).toBe(false);
    for (const ok of [-500, 0, 10, 500])
      expect(
        preferencesPatchSchema.safeParse({ audioOffsetMs: ok }).success,
      ).toBe(true);
  });

  it("accepte null pour une clé automatique, et le conserve", () => {
    patchPreferences(db, userId, { arabicSize: 48, leftPanelOpen: false });
    const view = patchPreferences(db, userId, { arabicSize: null });
    expect(view.preferences.arabicSize).toBeNull();
    expect(view.preferences.leftPanelOpen).toBe(false);
  });

  it("isole les comptes", () => {
    const other = createUser(db, { username: "Awa", passwordHash: "x" }).id;
    patchPreferences(db, userId, { theme: "dark" });
    expect(readPreferences(db, other).preferences.theme).toBe("system");
  });

  it("remet une clé ou tout à zéro", () => {
    patchPreferences(db, userId, { theme: "dark", volume: 0.2 });
    expect(resetPreferences(db, userId, "theme").preferences.theme).toBe(
      "system",
    );
    expect(readPreferences(db, userId).preferences.volume).toBe(0.2);
    expect(resetPreferences(db, userId).preferences.volume).toBe(1);
  });

  it("ignore une valeur corrompue en base au lieu de casser la lecture", () => {
    db.prepare(
      "INSERT INTO preferences (user_id, key, value, updated_at) VALUES (?, 'theme', '\"fluo\"', 'now')",
    ).run(userId);
    db.prepare(
      "INSERT INTO preferences (user_id, key, value, updated_at) VALUES (?, 'volume', '{pas du json', 'now')",
    ).run(userId);
    db.prepare(
      "INSERT INTO preferences (user_id, key, value, updated_at) VALUES (?, 'ancienne_cle', 'true', 'now')",
    ).run(userId);
    const view = readPreferences(db, userId);
    expect(view.preferences.theme).toBe("system");
    expect(view.preferences.volume).toBe(1);
    expect(view.updated_at).toEqual({});
  });
});

describe("préférences : réglages de la vidéo enregistrés avant le modèle à blocs", () => {
  const store = (value: unknown) =>
    db
      .prepare(
        "INSERT INTO preferences (user_id, key, value, updated_at) VALUES (?, 'videoPrefs', ?, '2026-10-01T00:00:00.000Z')",
      )
      .run(userId, JSON.stringify(value));

  it("un compte qui avait des réglages à plat les retrouve convertis, avec leur horodatage", () => {
    store({
      orientation: "9:16",
      arabicSize: 120,
      translationSize: 52,
      showTranslation: false,
      textPosition: 88,
      fill: true,
      showWave: true,
      bg: "#223344",
      background: "desert-dunes",
    });
    const view = readPreferences(db, userId);
    const prefs = view.preferences.videoPrefs;
    expect(prefs.orientation).toBe("9:16");
    expect(prefs.showTranslation).toBe(false);
    expect(prefs.styles.arabic.size).toBeCloseTo(120 / 72, 3);
    expect(prefs.styles.translation.size).toBeCloseTo(52 / 30, 3);
    expect(prefs.styles.arabic.fill).toBe(true);
    expect(prefs.background).toBe("desert-dunes");
    expect(view.updated_at.videoPrefs).toBe("2026-10-01T00:00:00.000Z");
  });

  it("une valeur abîmée dans le nouveau format ne fait pas perdre le reste", () => {
    const custom = structuredClone(PREFERENCE_DEFAULTS.videoPrefs);
    custom.orientation = "1:1";
    custom.styles.translation.size = 1.5;
    (custom.styles.arabic.panel as { kind: string }).kind = "verre";
    store(custom);
    const prefs = readPreferences(db, userId).preferences.videoPrefs;
    expect(prefs.orientation).toBe("1:1");
    expect(prefs.styles.translation.size).toBe(1.5);
    expect(prefs.styles.arabic.panel.kind).toBe(
      PREFERENCE_DEFAULTS.videoPrefs.styles.arabic.panel.kind,
    );
  });

  it("un contenu qui n'est pas un objet retombe sur les défauts", () => {
    store("pas des réglages");
    expect(readPreferences(db, userId).preferences.videoPrefs).toEqual(
      PREFERENCE_DEFAULTS.videoPrefs,
    );
  });
});

describe("préférences : schéma strict du corps", () => {
  const ok = (value: unknown) =>
    preferencesPatchSchema.safeParse(value).success;

  it("accepte un corps partiel valide", () => {
    expect(ok({})).toBe(true);
    expect(
      ok({
        theme: "light",
        visibleSpanSeconds: null,
        arabicFont: "amiri-quran",
      }),
    ).toBe(true);
    expect(
      ok({
        sessionsFilter: {
          scope: "mine",
          state: "done",
          engine: "all",
          sort: "name",
        },
      }),
    ).toBe(true);
  });

  it("refuse les clés inconnues", () => {
    expect(ok({ unknown: 1 })).toBe(false);
    expect(
      ok({ theme: "dark", __proto__: { admin: true }, role: "admin" }),
    ).toBe(false);
  });

  it("refuse les valeurs hors plage ou hors liste", () => {
    for (const bad of [
      { theme: "fluo" },
      { arabicFont: "comic-sans" },
      { arabicSize: 27 },
      { arabicSize: 30 },
      { arabicSize: 80 },
      { visibleSpanSeconds: 45 },
      { volume: 1.5 },
      { volume: -0.1 },
      { playbackRate: 0 },
      { playbackRate: 9 },
      { reviewTab: "secret" },
      { translation: "oui" },
      { sessionsFilter: { scope: "tout" } },
      {
        sessionsFilter: {
          scope: "all",
          state: "all",
          engine: "all",
          sort: "recent",
          x: 1,
        },
      },
    ])
      expect(ok(bad), JSON.stringify(bad)).toBe(false);
  });
});
