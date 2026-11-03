import { describe, expect, it } from "vitest";
import { drawWaveBars, maxPeak, peakColumns, waveBars } from "./export-wave";

/** 4 crêtes par seconde sur 3 s : 0,1 · 0,9 · 0,2 · 0,2 | 0,3 · 0,3 · 1 · 0,3 | 0 · 0,5 · 0,5 · 0,1 */
const peaks = {
  per_second: 4,
  duration: 3,
  peaks: [0.1, 0.9, 0.2, 0.2, 0.3, 0.3, 1, 0.3, 0, 0.5, 0.5, 0.1],
};

describe("maxPeak : la crête la plus haute d'un intervalle", () => {
  it("lit la plus haute crête entre deux instants", () => {
    expect(maxPeak(peaks, 0, 0.5)).toBe(0.9);
    expect(maxPeak(peaks, 1, 1.2)).toBe(0.3);
    expect(maxPeak(peaks, 1.2, 2)).toBe(1);
  });
  it("ne sort jamais du tableau (début négatif, fin au-delà)", () => {
    expect(maxPeak(peaks, -5, 0.2)).toBe(0.9);
    expect(maxPeak(peaks, 2.5, 99)).toBe(0.5);
  });
  it("vaut 0 sans aucune crête", () => {
    expect(maxPeak({ per_second: 4, duration: 0, peaks: [] }, 0, 1)).toBe(0);
  });
});

describe("peakColumns : une valeur par colonne de pixels", () => {
  it("découpe l'intervalle en colonnes égales", () => {
    const columns = peakColumns(peaks, 0, 3, 3);
    expect(Array.from(columns)).toEqual([
      Math.fround(0.9),
      Math.fround(1),
      Math.fround(0.5),
    ]);
  });
  it("aucune colonne : un tableau vide", () => {
    expect(peakColumns(peaks, 0, 3, 0)).toHaveLength(0);
  });
});

describe("waveBars : les barres à dessiner pour une fenêtre", () => {
  it("une barre tous les `step` pixels, avec son instant et sa hauteur", () => {
    const bars = waveBars(peaks, { a: 0, b: 3 }, 12, 4);
    expect(bars.map((bar) => bar.x)).toEqual([0, 4, 8]);
    expect(bars[0].t).toBe(0);
    expect(bars[1].t).toBeCloseTo(1, 9);
    expect(bars[0].level).toBe(0.9);
    expect(bars[1].level).toBe(1);
    expect(bars[2].level).toBe(0.5);
  });
  it("une fenêtre vue de près lit la bonne partie de l'onde", () => {
    const bars = waveBars(peaks, { a: 1.5, b: 2 }, 4, 2);
    expect(bars.map((bar) => bar.level)).toEqual([1, 0.3]);
  });
  it("largeur nulle ou sans onde : aucune barre", () => {
    expect(waveBars(peaks, { a: 0, b: 3 }, 0, 2)).toEqual([]);
    expect(waveBars(null, { a: 0, b: 3 }, 100, 2)).toEqual([]);
  });
});

describe("drawWaveBars : le dessin suit les barres", () => {
  it("remplit un rectangle par barre, centré sur la ligne médiane, de la couleur choisie à son instant", () => {
    const calls: Array<[number, number, number, number, unknown]> = [];
    let color: unknown = null;
    const g = {
      set fillStyle(value: unknown) {
        color = value;
      },
      fillRect(x: number, y: number, w: number, h: number) {
        calls.push([x, y, w, h, color]);
      },
    };
    drawWaveBars(g, {
      peaks,
      view: { a: 0, b: 3 },
      width: 12,
      step: 4,
      barWidth: 2,
      mid: 50,
      amp: 40,
      colorAt: (t) => (t < 0.5 ? "played" : "idle"),
    });
    expect(calls).toHaveLength(3);
    // 0,9 × 40 = 36 de part et d'autre de la ligne médiane (50)
    expect(calls[0]).toEqual([0, 14, 2, 72, "played"]);
    expect(calls[1][4]).toBe("idle");
    expect(calls[1][1]).toBe(10);
  });
  it("une barre garde au moins 1 px de demi-hauteur", () => {
    const rects: number[] = [];
    drawWaveBars(
      {
        fillStyle: "",
        fillRect: (_x: number, _y: number, _w: number, h: number) =>
          rects.push(h),
      },
      {
        peaks: { per_second: 1, duration: 1, peaks: [0] },
        view: { a: 0, b: 1 },
        width: 2,
        step: 2,
        barWidth: 1,
        mid: 10,
        amp: 8,
        colorAt: () => "x",
      },
    );
    expect(rects).toEqual([2]);
  });
});
