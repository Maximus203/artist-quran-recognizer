import { describe, expect, it } from "vitest";
import {
  AUDIO_OFFSET,
  calibrationWindow,
  clampAudioOffset,
  formatAudioOffset,
  heardTime,
  stepAudioOffset,
} from "./audio-offset";
import { currentWordIndex } from "./live-highlight";

describe("clampAudioOffset (−500 à +500 ms, pas de 10)", () => {
  it("borne et cale sur le pas", () => {
    expect(clampAudioOffset(900)).toBe(500);
    expect(clampAudioOffset(-900)).toBe(-500);
    expect(clampAudioOffset(143)).toBe(140);
    expect(clampAudioOffset(-147)).toBe(-150);
    expect(clampAudioOffset(0)).toBe(0);
  });
  it("revient au défaut (0) pour une valeur invalide, jamais -0", () => {
    expect(clampAudioOffset(Number.NaN)).toBe(AUDIO_OFFSET.fallback);
    expect(clampAudioOffset(Infinity)).toBe(0);
    expect(Object.is(clampAudioOffset(-3), -0)).toBe(false);
  });
});

describe("stepAudioOffset", () => {
  it("monte et descend de 10 ms, sans sortir des bornes", () => {
    expect(stepAudioOffset(0, 1)).toBe(10);
    expect(stepAudioOffset(0, -1)).toBe(-10);
    expect(stepAudioOffset(500, 1)).toBe(500);
    expect(stepAudioOffset(-500, -1)).toBe(-500);
  });
});

describe("heardTime : l'instant que l'oreille entend", () => {
  it("retarde : un décalage positif recule l'instant lu", () => {
    expect(heardTime(10, 200)).toBeCloseTo(9.8, 10);
  });
  it("un décalage négatif avance l'instant lu", () => {
    expect(heardTime(10, -200)).toBeCloseTo(10.2, 10);
  });
  it("0 laisse le temps inchangé (comportement actuel)", () => {
    expect(heardTime(12.345, 0)).toBe(12.345);
  });
  it("un décalage invalide est traité comme 0", () => {
    expect(heardTime(5, Number.NaN)).toBe(5);
  });
  it("ne descend jamais sous 0", () => {
    expect(heardTime(0.05, 300)).toBe(0);
  });
  it("retarde bien le mot surligné : le mot suivant n'apparaît qu'après le décalage", () => {
    const times = [
      [1, 1.5],
      [1.5, 2],
      [2, 2.5],
    ] as const;
    expect(currentWordIndex(times, heardTime(1.55, 0))).toBe(1);
    expect(currentWordIndex(times, heardTime(1.55, 100))).toBe(0);
    expect(currentWordIndex(times, heardTime(1.65, 100))).toBe(1);
    // avant le premier mot : rien n'est surligné tant que le son n'est pas arrivé
    expect(currentWordIndex(times, heardTime(1.05, 100))).toBe(-1);
  });
});

describe("calibrationWindow : le passage court lu en boucle pour caler à l'oreille", () => {
  it("garde un passage court tel quel", () => {
    expect(calibrationWindow([10, 14])).toEqual([10, 14]);
  });
  it("coupe un passage long à sa durée maximale, depuis son début", () => {
    expect(calibrationWindow([10, 60])).toEqual([
      10,
      10 + AUDIO_OFFSET.calibrationSpanS,
    ]);
  });
  it("refuse une plage absente ou vide", () => {
    expect(calibrationWindow(null)).toBeNull();
    expect(calibrationWindow([5, 5])).toBeNull();
    expect(calibrationWindow([5, 4])).toBeNull();
    expect(calibrationWindow([Number.NaN, 4])).toBeNull();
  });
});

describe("formatAudioOffset", () => {
  it("dit le sens en clair", () => {
    expect(formatAudioOffset(0)).toBe("0 ms");
    expect(formatAudioOffset(150)).toBe("+150 ms");
    expect(formatAudioOffset(-40)).toBe("−40 ms");
  });
});
