import { describe, expect, it } from "vitest";
import { DEFAULT_EXPORT_OPTIONS } from "./export-options";
import {
  EXPORT_PREFS_KEY,
  loadExportOptions,
  saveExportOptions,
} from "./export-prefs";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
};

describe("réglages d'export mémorisés", () => {
  it("revient sur les défauts sans rien de mémorisé, ou avec une valeur illisible", () => {
    expect(loadExportOptions(memory())).toEqual(DEFAULT_EXPORT_OPTIONS);
    const broken = memory();
    broken.setItem(EXPORT_PREFS_KEY, "{pas du json");
    expect(loadExportOptions(broken)).toEqual(DEFAULT_EXPORT_OPTIONS);
    const wrong = memory();
    wrong.setItem(EXPORT_PREFS_KEY, JSON.stringify({ format: "doc" }));
    expect(loadExportOptions(wrong)).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(loadExportOptions(null)).toEqual(DEFAULT_EXPORT_OPTIONS);
  });
  it("garde les réglages, mais jamais le forçage ni la politique", () => {
    const store = memory();
    saveExportOptions(
      {
        ...DEFAULT_EXPORT_OPTIONS,
        format: "ass",
        content: "ar",
        allow_unresolved: true,
        policy: "first",
      },
      store,
    );
    const saved = JSON.parse(store.data.get(EXPORT_PREFS_KEY)!);
    expect(saved).not.toHaveProperty("allow_unresolved");
    expect(saved).not.toHaveProperty("policy");
    expect(loadExportOptions(store)).toMatchObject({
      format: "ass",
      content: "ar",
      allow_unresolved: false,
      policy: "omit",
    });
  });
  it("un stockage qui lève n'empêche rien", () => {
    const hostile = {
      getItem: () => {
        throw new Error("bloqué");
      },
      setItem: () => {
        throw new Error("plein");
      },
    };
    expect(loadExportOptions(hostile)).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(() =>
      saveExportOptions(DEFAULT_EXPORT_OPTIONS, hostile),
    ).not.toThrow();
  });
  it("refuse des durées incohérentes mémorisées", () => {
    const store = memory();
    store.setItem(EXPORT_PREFS_KEY, JSON.stringify({ min_s: 9, max_s: 2 }));
    expect(loadExportOptions(store)).toEqual(DEFAULT_EXPORT_OPTIONS);
  });
});
