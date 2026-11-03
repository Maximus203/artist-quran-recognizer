import { describe, expect, it } from "vitest";
import {
  accentCss,
  accentFromPixels,
  DEFAULT_ACCENT,
  resolveAccent,
  SOFT_ACCENTS,
} from "./export-video-accent";

const pixel = (r: number, g: number, b: number, count = 50) =>
  Array.from({ length: count }, () => [r, g, b, 255]).flat();

describe("couleur d'accent", () => {
  it("écrit une couleur hsla lisible par le canvas", () => {
    expect(accentCss({ h: 43, s: 62, l: 64, a: 0.8 })).toBe(
      "hsla(43, 62%, 64%, 0.8)",
    );
  });

  it("prend la teinte dominante d'une image colorée", () => {
    const blue = accentFromPixels([
      ...pixel(20, 60, 200),
      ...pixel(120, 120, 120, 200),
    ]);
    expect(blue.h).toBeGreaterThan(210);
    expect(blue.h).toBeLessThan(240);
    expect(blue.l).toBeGreaterThanOrEqual(60);
  });

  it("retombe sur l'accent par défaut pour une image grise ou noire", () => {
    expect(accentFromPixels(pixel(120, 120, 120))).toEqual(DEFAULT_ACCENT);
    expect(accentFromPixels(pixel(5, 5, 5))).toEqual(DEFAULT_ACCENT);
    expect(accentFromPixels([])).toEqual(DEFAULT_ACCENT);
  });

  it("préfère le choix de l'utilisateur à l'automatique", () => {
    const custom = { h: 10, s: 50, l: 50, a: 0.9 };
    expect(resolveAccent(custom, DEFAULT_ACCENT)).toBe(custom);
    expect(resolveAccent(null, DEFAULT_ACCENT)).toBe(DEFAULT_ACCENT);
  });

  it("propose des couleurs douces toutes lisibles", () => {
    for (const color of SOFT_ACCENTS)
      expect(color.l).toBeGreaterThanOrEqual(60);
  });
});
