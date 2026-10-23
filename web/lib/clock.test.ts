import { describe, expect, it } from "vitest";
import { CLOCK_HZ, clockTime, dueForPublish } from "./clock";

describe("dueForPublish", () => {
  it("publie la première position tout de suite", () => {
    expect(dueForPublish(null, 1000)).toBe(true);
  });
  it("attend l'écart minimal : un écran à 240 Hz ne publie pas à chaque image", () => {
    let last: number | null = null;
    let published = 0;
    for (let frame = 0; frame < 240; frame++) {
      const now = 1000 + (frame * 1000) / 240;
      if (dueForPublish(last, now)) {
        last = now;
        published++;
      }
    }
    expect(published).toBeGreaterThanOrEqual(55);
    expect(published).toBeLessThanOrEqual(62);
  });
  it("à 60 Hz, publie à chaque image malgré la gigue des horodatages", () => {
    let last: number | null = null;
    let published = 0;
    for (let frame = 0; frame < 60; frame++) {
      const now = 1000 + frame * 16.67 + (frame % 2 ? -0.6 : 0.4);
      if (dueForPublish(last, now)) {
        last = now;
        published++;
      }
    }
    expect(published).toBe(60);
  });
  it("republie si l'horloge a reculé (nouvelle lecture, onglet réveillé)", () => {
    expect(dueForPublish(5000, 1000)).toBe(true);
  });
});

describe("clockTime", () => {
  it("à l'arrêt, donne la position exacte (un saut s'affiche au dixième de seconde près)", () => {
    expect(clockTime({ time: 12.3456, playing: false }, CLOCK_HZ)).toBe(
      12.3456,
    );
  });
  it("en lecture, tombe sur une grille de 1/hz : au plus hz changements par seconde", () => {
    const seen = new Set<number>();
    for (let frame = 0; frame < 240; frame++)
      seen.add(clockTime({ time: 10 + frame / 240, playing: true }, 20));
    expect(seen.size).toBeLessThanOrEqual(21);
  });
  it("ne dépasse jamais la position réelle et ne recule pas", () => {
    let last = -1;
    for (let t = 0; t < 5; t += 0.0137) {
      const shown = clockTime({ time: t, playing: true }, 20);
      expect(shown).toBeLessThanOrEqual(t + 1e-9);
      expect(shown).toBeGreaterThanOrEqual(last);
      last = shown;
    }
  });
  it("une fréquence invalide retombe sur la position exacte", () => {
    expect(clockTime({ time: 3.21, playing: true }, 0)).toBe(3.21);
    expect(clockTime({ time: 3.21, playing: true }, Number.NaN)).toBe(3.21);
  });
});
