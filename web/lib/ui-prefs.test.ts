import { describe, expect, it } from "vitest";
import { PREFS_CACHE_KEY } from "./prefs-sync";
import { BOOTSTRAP_SCRIPT } from "./ui-bootstrap";
import { clampQuranSize, effectiveTheme, stepQuranSize } from "./ui-prefs";

describe("clampQuranSize (28–72 px, pas de 4)", () => {
  it("borne et cale sur le pas", () => {
    expect(clampQuranSize(10)).toBe(28);
    expect(clampQuranSize(100)).toBe(72);
    expect(clampQuranSize(41)).toBe(40);
    expect(clampQuranSize(43)).toBe(44);
  });
  it("revient à 40 pour une valeur invalide", () => {
    expect(clampQuranSize(Number.NaN)).toBe(40);
  });
});

describe("stepQuranSize", () => {
  it("monte et descend de 4 px, sans sortir des bornes", () => {
    expect(stepQuranSize(40, 1)).toBe(44);
    expect(stepQuranSize(40, -1)).toBe(36);
    expect(stepQuranSize(72, 1)).toBe(72);
    expect(stepQuranSize(28, -1)).toBe(28);
  });
});

describe("effectiveTheme", () => {
  it("suit le système sauf choix explicite", () => {
    expect(effectiveTheme("system", true)).toBe("dark");
    expect(effectiveTheme("system", false)).toBe("light");
    expect(effectiveTheme("light", true)).toBe("light");
    expect(effectiveTheme("dark", false)).toBe("dark");
  });
});

describe("BOOTSTRAP_SCRIPT (pages sans compte, avant le premier rendu)", () => {
  function run(stored: string | null | "throw") {
    const attributes: Record<string, string> = {};
    const root = {
      setAttribute: (k: string, v: string) => (attributes[k] = v),
    };
    const storage = {
      getItem: (key: string) => {
        if (stored === "throw") throw new Error("stockage bloqué");
        return key === PREFS_CACHE_KEY ? stored : null;
      },
    };
    new Function("root", "storage", BOOTSTRAP_SCRIPT)(root, storage);
    return attributes;
  }
  it("reprend le thème mémorisé", () => {
    expect(
      run(JSON.stringify({ prefs: { theme: "dark" } }))["data-theme"],
    ).toBe("dark");
  });
  it("ne force aucun thème quand on suit le système", () => {
    expect(
      run(JSON.stringify({ prefs: { theme: "system" } }))["data-theme"],
    ).toBeUndefined();
  });
  it("ne plante jamais : stockage bloqué, JSON invalide, rien de mémorisé", () => {
    expect(run("throw")).toEqual({});
    expect(run("{pas du json")).toEqual({});
    expect(run(null)).toEqual({});
    expect(run(JSON.stringify({ prefs: { theme: "néon" } }))).toEqual({});
  });
});
