import { describe, expect, it } from "vitest";
import {
  findSilences,
  padRanges,
  suggestRanges,
  suggestionNotes,
  type SuggestPeaks,
  type SuggestTiming,
} from "./export-video-suggest";

const RATE = 50;

/** Onde synthétique : du bruit faible partout, de la « voix » forte dans les intervalles donnés. */
function wave(duration: number, voiced: [number, number][]): SuggestPeaks {
  const peaks: number[] = [];
  for (let i = 0; i < duration * RATE; i++) {
    const t = i / RATE;
    const loud = voiced.some(([a, b]) => t >= a && t < b);
    peaks.push(loud ? 20000 + ((i * 37) % 3000) : 200 + ((i * 13) % 100));
  }
  return { per_second: RATE, duration, peaks };
}

const verse = (
  ref: string,
  start: number,
  end: number,
  status = "recognized",
): SuggestTiming => ({ kind: "verse", ref, status, t: [start, end] });

describe("silences", () => {
  it("trouve les silences de l'onde, pas la voix", () => {
    const silences = findSilences(wave(10, [[2, 4]]));
    expect(silences).toHaveLength(2);
    expect(silences[0].start).toBeCloseTo(0, 1);
    expect(silences[0].end).toBeLessThanOrEqual(2.05);
    expect(silences[1].start).toBeGreaterThanOrEqual(3.95);
  });
  it("ne renvoie rien sans onde", () => {
    expect(findSilences({ per_second: RATE, duration: 0, peaks: [] })).toEqual(
      [],
    );
  });
});

describe("suggestRanges", () => {
  const voiced: [number, number][] = [
    [5, 9],
    [10, 14],
    [20, 24],
  ];
  const intervals: SuggestTiming[] = [
    verse("91:1", 5, 9),
    verse("91:2", 10, 14),
    verse("91:3", 20, 24, "inferred"),
    { kind: "verse", ref: null, status: "uncertain", t: [30, 33] },
    { kind: "non_quran", t: [40, 42] } as SuggestTiming,
  ];
  const peaks = wave(45, voiced);

  it("commence avant et finit après chaque verset, sans jamais entrer dans la voix", () => {
    const ranges = suggestRanges(intervals, 45, peaks, {
      snapToSilence: false,
    });
    expect(ranges.map((r) => r.refs[0])).toEqual(["91:1", "91:2", "91:3"]);
    expect(ranges[0].start).toBeCloseTo(4.4, 2);
    expect(ranges[0].end).toBeCloseTo(9.4, 2);
    expect(ranges[0].lead_in).toBeCloseTo(0.6, 2);
    expect(ranges[0].tail_out).toBeCloseTo(0.4, 2);
  });

  it("coupe au milieu de l'écart quand le voisin est trop proche", () => {
    const ranges = suggestRanges(intervals, 45, peaks, {
      snapToSilence: false,
    });
    // 91:1 finit à 9, 91:2 commence à 10 : écart de 1 s, marge de fin de 0,4 s : tient.
    // Avec une grande marge, les deux se partagent l'écart sans se chevaucher.
    const wide = suggestRanges(intervals, 45, peaks, {
      snapToSilence: false,
      leadIn: 2,
      tailOut: 2,
    });
    expect(wide[0].end).toBeLessThanOrEqual(9.5 + 1e-9);
    expect(wide[1].start).toBeGreaterThanOrEqual(9.5 - 1e-9);
    expect(wide[0].end).toBeLessThanOrEqual(wide[1].start + 1e-9);
    expect(wide[0].warnings.join(" ")).toMatch(/marge de fin est réduite/);
    expect(ranges.length).toBe(3);
  });

  it("aimante les bords vers le silence, hors de la voix", () => {
    const ranges = suggestRanges(intervals, 45, peaks);
    for (const r of ranges) {
      expect(r.snapped.start).toBe(true);
      expect(r.snapped.end).toBe(true);
      expect(r.start).toBeLessThan(r.core_start);
      expect(r.end).toBeGreaterThan(r.core_end);
    }
    // Aucun bord ne tombe dans une zone de voix.
    for (const r of ranges)
      for (const edge of [r.start, r.end])
        expect(voiced.some(([a, b]) => edge >= a && edge < b)).toBe(false);
  });

  it("n'inclut jamais un passage incertain ni une zone non coranique, et signale le déduit", () => {
    const ranges = suggestRanges(intervals, 45, peaks);
    expect(ranges.some((r) => r.core_start === 30 || r.core_start === 40)).toBe(
      false,
    );
    expect(ranges[2].status).toBe("inferred");
    expect(suggestionNotes(ranges).join(" ")).toMatch(/inferred/);
    expect(
      suggestRanges(intervals, 45, peaks, { includeInferred: false }),
    ).toHaveLength(2);
  });

  it("regroupe les versets enchaînés en un passage", () => {
    const ranges = suggestRanges(intervals, 45, peaks, {
      group: "passage",
      mergeGap: 1.5,
      snapToSilence: false,
    });
    expect(ranges).toHaveLength(2);
    expect(ranges[0].refs).toEqual(["91:1", "91:2"]);
    expect(ranges[0].core_start).toBe(5);
    expect(ranges[0].core_end).toBe(14);
  });

  it("reste dans l'audio et prévient quand la récitation touche un bord", () => {
    const edge = suggestRanges(
      [verse("1:1", 0, 3), verse("1:2", 3.2, 9.98)],
      10,
      null,
    );
    expect(edge[0].start).toBe(0);
    expect(edge[1].end).toBeLessThanOrEqual(10);
    expect(edge[0].warnings.join(" ")).toMatch(/dès le début/);
    expect(edge[1].warnings.join(" ")).toMatch(/jusqu'à la fin/);
  });

  it("sans onde : marges fixes, sans aimantation", () => {
    const ranges = suggestRanges([verse("1:1", 5, 9)], 20, null);
    expect(ranges[0].snapped).toEqual({ start: false, end: false });
    expect(ranges[0].start).toBeCloseTo(4.4, 3);
  });

  it("borne les marges demandées", () => {
    const ranges = suggestRanges([verse("1:1", 10, 12)], 30, null, {
      leadIn: 99,
      tailOut: -4,
    });
    expect(ranges[0].lead_in).toBe(5);
    expect(ranges[0].tail_out).toBe(0);
  });

  it("dit quand il n'y a rien à découper", () => {
    expect(suggestionNotes(suggestRanges([], 10, null)).join(" ")).toMatch(
      /Aucun passage/,
    );
  });
});

describe("padRanges", () => {
  const intervals = [verse("91:1", 5, 9), verse("91:2", 12, 16)];
  it("élargit une plage qui coupe un passage, sans toucher aux autres", () => {
    const out = padRanges(
      [
        { start: 5.2, end: 8.9 },
        { start: 30, end: 35 },
      ],
      intervals,
      40,
      null,
      { snapToSilence: false },
    );
    expect(out[0].start).toBeCloseTo(4.4, 2);
    expect(out[0].end).toBeCloseTo(9.4, 2);
    expect(out[1]).toEqual({ start: 30, end: 35 });
  });
});
