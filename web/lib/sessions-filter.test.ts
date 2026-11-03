import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSIONS_FILTER,
  activeFilterCount,
  clearedFilter,
  datePresetOf,
  fromPreference,
  filterFromUrl,
  filterToUrl,
  hasUrlFilter,
  isDefaultFilter,
  presetRange,
  toPreference,
  toSearchParams,
  type SessionsFilter,
} from "./sessions-filter";

const base: SessionsFilter = { ...DEFAULT_SESSIONS_FILTER };
// Mercredi 21 octobre 2026, midi local.
const NOW = new Date(2026, 9, 21, 12).getTime();

describe("toSearchParams", () => {
  it("n'écrit que ce qui s'écarte du défaut", () => {
    expect(toSearchParams(base, { limit: 20 }).toString()).toBe(
      "scope=all&limit=20",
    );
  });

  it("traduit chaque filtre vers le paramètre d'API, listes comprises", () => {
    const params = toSearchParams(
      {
        scope: "mine",
        states: ["done", "failed"],
        engines: ["whisper", "cascade"],
        sort: "name",
        q: "  yusuf  ",
        from: "",
        to: "",
      },
      { limit: 20, cursor: "abc" },
    );
    expect(Object.fromEntries(params)).toEqual({
      scope: "mine",
      state: "done,failed",
      engine: "whisper,cascade",
      sort: "name",
      q: "yusuf",
      limit: "20",
      cursor: "abc",
    });
  });

  it("les jours locaux deviennent des bornes ISO couvrant la journée entière", () => {
    const params = toSearchParams(
      { ...base, from: "2026-10-01", to: "2026-10-22" },
      { limit: 8 },
    );
    expect(params.get("from")).toBe(
      new Date(2026, 9, 1, 0, 0, 0, 0).toISOString(),
    );
    expect(params.get("to")).toBe(
      new Date(2026, 9, 22, 23, 59, 59, 999).toISOString(),
    );
  });

  it("ignore une date illisible et une recherche faite d'espaces", () => {
    const params = toSearchParams(
      { ...base, q: "   ", from: "hier" },
      { limit: 8 },
    );
    expect(params.has("q")).toBe(false);
    expect(params.has("from")).toBe(false);
  });

  it("borne la recherche à 100 caractères, comme le serveur", () => {
    const params = toSearchParams(
      { ...base, q: "x".repeat(300) },
      { limit: 8 },
    );
    expect(params.get("q")?.length).toBe(100);
  });
});

describe("activeFilterCount / isDefaultFilter / clearedFilter", () => {
  it("compte les critères actifs, hors tri et portée par défaut", () => {
    expect(activeFilterCount(base)).toBe(0);
    expect(isDefaultFilter(base)).toBe(true);
    expect(
      activeFilterCount({
        ...base,
        scope: "favorites",
        states: ["active", "unread"],
        engines: ["cascade"],
        q: "a",
        from: "2026-10-01",
      }),
    ).toBe(5);
  });

  it("plusieurs états comptent pour un seul critère, comme une plage de dates", () => {
    expect(activeFilterCount({ ...base, states: ["done", "failed"] })).toBe(1);
    expect(
      activeFilterCount({ ...base, from: "2026-10-01", to: "2026-10-05" }),
    ).toBe(1);
  });

  it("un tri différent n'est pas un filtre mais sort du défaut", () => {
    expect(activeFilterCount({ ...base, sort: "size" })).toBe(0);
    expect(isDefaultFilter({ ...base, sort: "size" })).toBe(false);
  });

  it("« Tout effacer » garde le tri choisi", () => {
    const cleared = clearedFilter({
      ...base,
      sort: "size",
      q: "x",
      states: ["done"],
    });
    expect(cleared).toEqual({ ...base, sort: "size" });
  });
});

describe("préférence ↔ filtre", () => {
  it("restitue le filtre enregistré, sans recherche ni dates (jamais mémorisées)", () => {
    expect(
      fromPreference({
        scope: "shared",
        state: "unread",
        engine: "all",
        sort: "oldest",
      }),
    ).toEqual({
      scope: "shared",
      states: ["unread"],
      engines: [],
      sort: "oldest",
      q: "",
      from: "",
      to: "",
    });
  });

  it("n'enregistre qu'un état et un moteur unique ; plusieurs = tous", () => {
    expect(
      toPreference({
        ...base,
        scope: "mine",
        q: "x",
        from: "2026-01-01",
        states: ["done"],
        engines: ["whisper", "cascade"],
      }),
    ).toEqual({ scope: "mine", state: "done", engine: "all", sort: "recent" });
  });
});

describe("adresse de la page", () => {
  it("fait l'aller-retour", () => {
    const filter: SessionsFilter = {
      scope: "favorites",
      states: ["done", "unread"],
      engines: ["cascade"],
      sort: "duration",
      q: "yusuf",
      from: "2026-10-01",
      to: "2026-10-22",
    };
    const url = filterToUrl(filter);
    expect(url.toString()).toBe(
      "q=yusuf&portee=fav&etat=done%2Cunread&moteur=cascade&du=2026-10-01&au=2026-10-22&tri=duration",
    );
    expect(filterFromUrl(url)).toEqual(filter);
  });

  it("un filtre par défaut donne une adresse vide", () => {
    expect(filterToUrl(base).toString()).toBe("");
    expect(hasUrlFilter(new URLSearchParams(""))).toBe(false);
    expect(hasUrlFilter(new URLSearchParams("q=a"))).toBe(true);
  });

  it("jamais fiable : valeurs inconnues ignorées, dates invalides vidées", () => {
    const filter = filterFromUrl(
      new URLSearchParams(
        "portee=pirate&etat=done,magie&moteur=gpt&tri=hasard&du=bientot&au=2026-02-30x&q=" +
          "z".repeat(300),
      ),
    );
    expect(filter.scope).toBe("all");
    expect(filter.states).toEqual(["done"]);
    expect(filter.engines).toEqual([]);
    expect(filter.sort).toBe("recent");
    expect(filter.from).toBe("");
    expect(filter.to).toBe("");
    expect(filter.q.length).toBe(100);
  });
});

describe("raccourcis de période", () => {
  it("aujourd'hui, 7 jours et 30 jours sont des jours locaux inclusifs", () => {
    expect(presetRange("today", NOW)).toEqual({
      from: "2026-10-21",
      to: "2026-10-21",
    });
    expect(presetRange("7", NOW)).toEqual({
      from: "2026-10-15",
      to: "2026-10-21",
    });
    expect(presetRange("30", NOW)).toEqual({
      from: "2026-09-22",
      to: "2026-10-21",
    });
  });
  it("reconnaît un raccourci, sinon « personnalisée », sinon rien", () => {
    expect(datePresetOf(presetRange("7", NOW), NOW)).toBe("7");
    expect(datePresetOf({ from: "2026-10-01", to: "2026-10-05" }, NOW)).toBe(
      "custom",
    );
    expect(datePresetOf({ from: "", to: "" }, NOW)).toBeNull();
  });
});
