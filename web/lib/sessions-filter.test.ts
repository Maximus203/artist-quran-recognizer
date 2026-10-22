import { describe, expect, it } from "vitest";
import {
  DEFAULT_SESSIONS_FILTER,
  activeFilterCount,
  fromPreference,
  isDefaultFilter,
  toPreference,
  toSearchParams,
  type SessionsFilter,
} from "./sessions-filter";

const base: SessionsFilter = { ...DEFAULT_SESSIONS_FILTER };

describe("toSearchParams", () => {
  it("n'écrit que ce qui s'écarte du défaut", () => {
    expect(toSearchParams(base, { limit: 20 }).toString()).toBe(
      "scope=all&limit=20",
    );
  });

  it("traduit chaque filtre vers le paramètre d'API", () => {
    const params = toSearchParams(
      {
        scope: "mine",
        state: "done",
        engine: "whisper",
        sort: "name",
        q: "  yusuf  ",
        from: "2026-10-01",
        to: "2026-10-22",
      },
      { limit: 20, cursor: "abc" },
    );
    expect(Object.fromEntries(params)).toEqual({
      scope: "mine",
      state: "done",
      engine: "whisper",
      sort: "name",
      q: "yusuf",
      from: "2026-10-01",
      to: "2026-10-22",
      limit: "20",
      cursor: "abc",
    });
  });

  it("ignore une recherche vide ou faite d'espaces", () => {
    expect(toSearchParams({ ...base, q: "   " }, { limit: 8 }).has("q")).toBe(
      false,
    );
  });

  it("borne la recherche à 100 caractères, comme le serveur", () => {
    const params = toSearchParams({ ...base, q: "x".repeat(300) }, { limit: 8 });
    expect(params.get("q")?.length).toBe(100);
  });
});

describe("activeFilterCount / isDefaultFilter", () => {
  it("compte les critères actifs, hors tri et portée par défaut", () => {
    expect(activeFilterCount(base)).toBe(0);
    expect(isDefaultFilter(base)).toBe(true);
    expect(
      activeFilterCount({
        ...base,
        scope: "favorites",
        state: "active",
        engine: "cascade",
        q: "a",
        from: "2026-10-01",
      }),
    ).toBe(5);
  });

  it("une plage de dates compte pour un seul critère", () => {
    expect(
      activeFilterCount({ ...base, from: "2026-10-01", to: "2026-10-05" }),
    ).toBe(1);
  });

  it("un tri différent n'est pas un filtre mais sort du défaut", () => {
    expect(activeFilterCount({ ...base, sort: "size" })).toBe(0);
    expect(isDefaultFilter({ ...base, sort: "size" })).toBe(false);
  });
});

describe("préférence ↔ filtre", () => {
  it("restitue le filtre enregistré, sans recherche ni dates (jamais mémorisées)", () => {
    const filter = fromPreference({
      scope: "shared",
      state: "unread",
      engine: "all",
      sort: "oldest",
    });
    expect(filter).toEqual({
      scope: "shared",
      state: "unread",
      engine: "all",
      sort: "oldest",
      q: "",
      from: "",
      to: "",
    });
  });

  it("n'enregistre que portée, état, moteur et tri", () => {
    expect(
      toPreference({ ...base, scope: "mine", q: "x", from: "2026-01-01" }),
    ).toEqual({ scope: "mine", state: "all", engine: "all", sort: "recent" });
  });
});
