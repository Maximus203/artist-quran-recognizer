import { describe, expect, it } from "vitest";
import { BOOTSTRAP_SCRIPT } from "./ui-bootstrap";
import {
  DEFAULT_PREFS,
  UI_STORAGE_KEY,
  clampQuranSize,
  effectiveTheme,
  parsePrefs,
  serializePrefs,
  stepQuranSize,
} from "./ui-prefs";

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

describe("parsePrefs (stockage du navigateur, jamais de confiance)", () => {
  it("renvoie les valeurs par défaut sans donnée ou avec un JSON cassé", () => {
    expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("{pas du json")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("42")).toEqual(DEFAULT_PREFS);
  });
  it("relit des préférences valides", () => {
    const raw = JSON.stringify({
      theme: "light",
      font: "scheherazade",
      size: 48,
      left: false,
      right: true,
      translation: false,
      shortcuts: false,
      tester: "Awa",
      testers: ["Awa", "Moussa"],
    });
    expect(parsePrefs(raw)).toEqual({
      theme: "light",
      font: "scheherazade",
      size: 48,
      left: false,
      right: true,
      translation: false,
      shortcuts: false,
      tester: "Awa",
      testers: ["Awa", "Moussa"],
    });
  });
  it("écarte champ par champ ce qui est invalide", () => {
    const parsed = parsePrefs(
      JSON.stringify({
        theme: "néon",
        font: "comic-sans",
        size: 9999,
        left: "oui",
        tester: "a@b.fr",
        testers: ["ok-nom", 5, "x"],
        translation: "peut-être",
      }),
    );
    expect(parsed.theme).toBe("system");
    expect(parsed.font).toBeNull();
    expect(parsed.size).toBe(72);
    expect(parsed.left).toBeNull();
    expect(parsed.tester).toBeNull();
    expect(parsed.testers).toEqual(["ok-nom"]);
    expect(parsed.translation).toBe(true);
  });
  it("ne revient jamais avec du HTML dans un pseudonyme", () => {
    expect(
      parsePrefs(JSON.stringify({ tester: "<img src=x onerror=1>" })).tester,
    ).toBeNull();
  });
});

describe("serializePrefs", () => {
  it("fait l'aller-retour", () => {
    const prefs = { ...DEFAULT_PREFS, theme: "dark" as const, size: 56 };
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
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

describe("BOOTSTRAP_SCRIPT (posé dans <head> avant le premier rendu)", () => {
  function run(stored: string | null | "throw") {
    const attributes: Record<string, string> = {};
    const styles: Record<string, string> = {};
    const root = {
      setAttribute: (k: string, v: string) => (attributes[k] = v),
      style: { setProperty: (k: string, v: string) => (styles[k] = v) },
    };
    const storage = {
      getItem: (key: string) => {
        if (stored === "throw") throw new Error("stockage bloqué");
        return key === UI_STORAGE_KEY ? stored : null;
      },
    };
    new Function("root", "storage", BOOTSTRAP_SCRIPT)(root, storage);
    return { attributes, styles };
  }
  it("pose le thème, la police et la taille mémorisés", () => {
    const { attributes, styles } = run(
      JSON.stringify({ theme: "dark", font: "scheherazade", size: 52 }),
    );
    expect(attributes["data-theme"]).toBe("dark");
    expect(attributes["data-quran-font"]).toBe("scheherazade");
    expect(styles["--quran-size"]).toBe("52px");
  });
  it("ne force aucun thème quand on suit le système", () => {
    const { attributes } = run(JSON.stringify({ theme: "system" }));
    expect(attributes["data-theme"]).toBeUndefined();
  });
  it("retombe sur Amiri Quran sans choix, et ignore une police inconnue", () => {
    expect(run(null).attributes["data-quran-font"]).toBe("amiri-quran");
    expect(
      run(JSON.stringify({ font: "n-importe-quoi" })).attributes[
        "data-quran-font"
      ],
    ).toBe("amiri-quran");
  });
  it("ne casse rien si le stockage est bloqué ou le JSON invalide", () => {
    expect(() => run("throw")).not.toThrow();
    expect(() => run("{cassé")).not.toThrow();
    expect(run("throw").attributes["data-quran-font"]).toBe("amiri-quran");
  });
  it("borne la taille mémorisée", () => {
    expect(run(JSON.stringify({ size: 9999 })).styles["--quran-size"]).toBe(
      "72px",
    );
  });
});
