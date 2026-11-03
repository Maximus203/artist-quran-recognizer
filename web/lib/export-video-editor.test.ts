import { describe, expect, it } from "vitest";
import {
  PANEL_SWATCHES,
  canHide,
  isVisible,
  resetBlockBox,
  resetLayout,
  setBlockBox,
  setPanel,
  setTextSize,
  setVisibility,
  stepWaveBox,
  visibilityOf,
  waveLimits,
} from "./export-video-editor";
import {
  DEFAULT_LAYOUTS,
  DEFAULT_STYLES,
  MIN_BOX,
  SIZE_LIMITS,
} from "./export-video-model";
import { DEFAULT_VIDEO_PREFS as prefs } from "./export-video-prefs";

describe("setBlockBox", () => {
  it("ne change que la boîte du bloc, dans le format demandé", () => {
    const box = { x: 0.1, y: 0.1, w: 0.5, h: 0.2 };
    const next = setBlockBox(prefs.layouts, "9:16", "arabic", box);
    expect(next["9:16"].arabic).toEqual(box);
    expect(next["9:16"].translation).toEqual(prefs.layouts["9:16"].translation);
    expect(next["16:9"]).toBe(prefs.layouts["16:9"]);
    expect(next["1:1"]).toBe(prefs.layouts["1:1"]);
  });

  it("ne modifie jamais l'objet reçu", () => {
    const before = structuredClone(prefs.layouts);
    setBlockBox(prefs.layouts, "16:9", "wave", { x: 0, y: 0.5, w: 1, h: 0.3 });
    expect(prefs.layouts).toEqual(before);
  });

  it("ramène une boîte hors cadre dans le cadre", () => {
    const next = setBlockBox(prefs.layouts, "16:9", "ref", {
      x: 0.9,
      y: 0.9,
      w: 0.5,
      h: 0.5,
    });
    const b = next["16:9"].ref;
    expect(b.x + b.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(b.y + b.h).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("resetBlockBox et resetLayout (remettre à la place d'origine)", () => {
  const moved = setBlockBox(prefs.layouts, "16:9", "arabic", {
    x: 0,
    y: 0,
    w: 0.2,
    h: 0.2,
  });

  it("remet un seul bloc à sa place, les autres restent", () => {
    const edited = setBlockBox(moved, "16:9", "wave", {
      x: 0,
      y: 0.2,
      w: 1,
      h: 0.2,
    });
    const next = resetBlockBox(edited, "16:9", "arabic");
    expect(next["16:9"].arabic).toEqual(DEFAULT_LAYOUTS["16:9"].arabic);
    expect(next["16:9"].wave).toEqual({ x: 0, y: 0.2, w: 1, h: 0.2 });
  });

  it("remet toute la mise en page du format, sans toucher aux autres formats", () => {
    const other = setBlockBox(moved, "9:16", "wave", {
      x: 0,
      y: 0.2,
      w: 1,
      h: 0.2,
    });
    const next = resetLayout(other, "16:9");
    expect(next["16:9"]).toEqual(DEFAULT_LAYOUTS["16:9"]);
    expect(next["9:16"].wave).toEqual({ x: 0, y: 0.2, w: 1, h: 0.2 });
  });

  it("rend des copies : modifier le résultat ne change pas les défauts", () => {
    const next = resetLayout(moved, "16:9");
    next["16:9"].arabic.x = 0.9;
    expect(DEFAULT_LAYOUTS["16:9"].arabic.x).toBe(0.08);
  });
});

describe("setTextSize", () => {
  it("change la taille d'un seul texte", () => {
    const next = setTextSize(DEFAULT_STYLES, "translation", 1.3);
    expect(next.translation.size).toBe(1.3);
    expect(next.arabic).toBe(DEFAULT_STYLES.arabic);
    expect(next.ref).toBe(DEFAULT_STYLES.ref);
  });

  it("borne la taille", () => {
    expect(setTextSize(DEFAULT_STYLES, "arabic", 99).arabic.size).toBe(
      SIZE_LIMITS.max,
    );
    expect(setTextSize(DEFAULT_STYLES, "arabic", 0).arabic.size).toBe(
      SIZE_LIMITS.min,
    );
  });

  it("une taille invalide laisse les styles tels quels", () => {
    expect(setTextSize(DEFAULT_STYLES, "arabic", Number.NaN)).toBe(
      DEFAULT_STYLES,
    );
  });
});

describe("setPanel (fond du texte)", () => {
  it("change le genre de fond d'un texte sans toucher à l'autre", () => {
    const next = setPanel(DEFAULT_STYLES, "translation", { kind: "blur" });
    expect(next.translation.panel.kind).toBe("blur");
    expect(next.arabic.panel.kind).toBe(DEFAULT_STYLES.arabic.panel.kind);
  });

  it("garde les autres réglages du fond", () => {
    const next = setPanel(DEFAULT_STYLES, "arabic", { radius: 12 });
    expect(next.arabic.panel.color).toBe(DEFAULT_STYLES.arabic.panel.color);
    expect(next.arabic.panel.radius).toBe(12);
  });

  it("borne la transparence et l'arrondi", () => {
    const next = setPanel(DEFAULT_STYLES, "arabic", {
      opacity: 7,
      radius: -3,
    });
    expect(next.arabic.panel.opacity).toBe(1);
    expect(next.arabic.panel.radius).toBe(0);
  });

  it("refuse une couleur qui n'est pas #rrggbb", () => {
    expect(setPanel(DEFAULT_STYLES, "arabic", { color: "rouge" })).toBe(
      DEFAULT_STYLES,
    );
    expect(setPanel(DEFAULT_STYLES, "arabic", { color: "#12345" })).toBe(
      DEFAULT_STYLES,
    );
    expect(
      setPanel(DEFAULT_STYLES, "arabic", { color: "#ABCDEF" }).arabic.panel
        .color,
    ).toBe("#abcdef");
  });

  it("le fond de la traduction et celui de l'arabe sont indépendants", () => {
    let styles = setPanel(DEFAULT_STYLES, "translation", { kind: "solid" });
    styles = setPanel(styles, "arabic", {
      kind: "none",
      legibility: "outline",
    });
    expect(styles.translation.panel.kind).toBe("solid");
    expect(styles.arabic.panel.kind).toBe("none");
    expect(styles.arabic.panel.legibility).toBe("outline");
  });
});

describe("PANEL_SWATCHES", () => {
  it("six couleurs au format #rrggbb, chacune avec un nom", () => {
    expect(PANEL_SWATCHES).toHaveLength(6);
    for (const s of PANEL_SWATCHES) {
      expect(s.value).toMatch(/^#[0-9a-f]{6}$/);
      expect(s.label.length).toBeGreaterThan(2);
    }
    expect(new Set(PANEL_SWATCHES.map((s) => s.value)).size).toBe(6);
  });
});

describe("visibilité des éléments", () => {
  it("lit les quatre éléments dans les réglages", () => {
    expect(visibilityOf(prefs)).toEqual({
      ref: true,
      arabic: true,
      translation: true,
      wave: true,
    });
    expect(isVisible({ ...prefs, showWave: false }, "wave")).toBe(false);
  });

  it("masque et affiche un élément", () => {
    expect(setVisibility(prefs, "translation", false)).toEqual({
      showTranslation: false,
    });
    expect(setVisibility(prefs, "wave", false)).toEqual({ showWave: false });
    expect(setVisibility(prefs, "ref", false)).toEqual({ showRef: false });
    expect(setVisibility(prefs, "arabic", true)).toEqual({ showArabic: true });
  });

  it("une des deux écritures reste affichée : masquer la dernière est refusé", () => {
    const onlyArabic = { ...prefs, showTranslation: false };
    expect(canHide(onlyArabic, "arabic")).toBe(false);
    expect(setVisibility(onlyArabic, "arabic", false)).toBeNull();
    expect(canHide(prefs, "arabic")).toBe(true);
    const onlyTranslation = { ...prefs, showArabic: false };
    expect(canHide(onlyTranslation, "translation")).toBe(false);
  });

  it("l'onde et la sourate se masquent toujours", () => {
    const bare = { ...prefs, showTranslation: false };
    expect(canHide(bare, "wave")).toBe(true);
    expect(canHide(bare, "ref")).toBe(true);
  });
});

describe("stepWaveBox (hauteur de l'onde)", () => {
  const wave = { x: 0, y: 0.78, w: 1, h: 0.22 };

  it("agrandit ou réduit de 2 % du cadre autour du milieu de l'onde", () => {
    const smaller = stepWaveBox({ x: 0, y: 0.5, w: 1, h: 0.2 }, -1);
    expect(smaller.h).toBeCloseTo(0.18, 6);
    expect(smaller.y + smaller.h / 2).toBeCloseTo(0.6, 6);
  });

  it("reste dans le cadre quand l'onde touche le bas", () => {
    const bigger = stepWaveBox(wave, 1);
    expect(bigger.h).toBeCloseTo(0.24, 6);
    expect(bigger.y + bigger.h).toBeLessThanOrEqual(1 + 1e-9);
  });

  it("ne descend pas sous la taille minimale", () => {
    let box = wave;
    for (let i = 0; i < 40; i++) box = stepWaveBox(box, -1);
    expect(box.h).toBe(MIN_BOX.h);
  });

  it("dit quand l'onde est au plus bas ou au plus haut (boutons désactivés)", () => {
    let low = wave;
    for (let i = 0; i < 40; i++) low = stepWaveBox(low, -1);
    expect(waveLimits(low)).toEqual({ atMin: true, atMax: false });
    let high = { x: 0, y: 0.2, w: 1, h: 0.3 };
    for (let i = 0; i < 40; i++) high = stepWaveBox(high, 1);
    expect(waveLimits(high)).toEqual({ atMin: false, atMax: true });
    expect(waveLimits(wave)).toEqual({ atMin: false, atMax: false });
  });
});
