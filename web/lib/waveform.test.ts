import { describe, expect, it } from "vitest";
import { barHeights, peakNorm } from "./waveform";

describe("peakNorm", () => {
  it("renvoie le plus grand pic", () => {
    expect(peakNorm([0.1, 0.8, 0.3])).toBe(0.8);
  });
  it("ne renvoie jamais zéro (évite la division par zéro sur un silence)", () => {
    expect(peakNorm([0, 0, 0])).toBeGreaterThan(0);
    expect(peakNorm([])).toBeGreaterThan(0);
  });
});

describe("barHeights", () => {
  // 50 crêtes par seconde, 10 s d'audio : 500 crêtes
  const peaks = Array.from({ length: 500 }, (_, i) => (i === 123 ? 1 : 0.2));
  it("rend le nombre de barres demandé, entre 0 et 1", () => {
    const bars = barHeights(peaks, 10, 0, 10, 50, 1);
    expect(bars).toHaveLength(50);
    for (const h of bars) {
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(1);
    }
  });
  it("garde le MAXIMUM de chaque tranche : un pic fin ne disparaît pas", () => {
    const bars = barHeights(peaks, 10, 0, 10, 50, 1);
    // le pic est à 123/50 = 2,46 s : tranche 12 (de 2,4 s à 2,6 s)
    expect(bars[12]).toBe(1);
    expect(bars[11]).toBeCloseTo(0.2);
  });
  it("normalise par le plus grand pic du fichier", () => {
    const bars = barHeights(
      [0.25, 0.25, 0.25, 0.25],
      4 / 50,
      0,
      4 / 50,
      2,
      0.5,
    );
    expect(bars).toEqual([0.5, 0.5]);
  });
  it("ne rend que la fenêtre visible", () => {
    const bars = barHeights(peaks, 10, 2.4, 2.6, 10, 1);
    expect(Math.max(...bars)).toBe(1);
    expect(bars).toHaveLength(10);
  });
  it("rend 0 hors du fichier (fenêtre qui déborde)", () => {
    const bars = barHeights(peaks, 10, 9, 12, 3, 1);
    expect(bars[2]).toBe(0);
    expect(bars[0]).toBeGreaterThan(0);
  });
  it("tolère une fenêtre vide, une durée nulle et zéro barre", () => {
    expect(barHeights(peaks, 10, 5, 5, 4, 1)).toEqual([0, 0, 0, 0]);
    expect(barHeights(peaks, 0, 0, 1, 2, 1)).toEqual([0, 0]);
    expect(barHeights(peaks, 10, 0, 10, 0, 1)).toEqual([]);
  });
});
