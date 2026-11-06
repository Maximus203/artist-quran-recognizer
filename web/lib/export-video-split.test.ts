import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Interval } from "./recognition";
import {
  DEFAULT_SPLIT,
  chunkRanges,
  pauseAfter,
  signStops,
  splitVerse,
} from "./export-video-split";

type SharedCase = {
  name: string;
  words: string[];
  times: [number, number][];
  pause_s: number;
  max_s: number;
  min_s: number;
  start_s: number;
  pauses: number[];
  stops: number[];
  chunks: [number, number][];
};

// Les mêmes cas que le moteur Python (tests/unit/test_export_pauses.py) : une coupe d'aperçu,
// de vidéo ou de sous-titres ne doit pas dépendre du langage qui la calcule.
const SHARED: SharedCase[] = JSON.parse(
  readFileSync(
    path.resolve(__dirname, "../../tests/fixtures/export-pauses/cases.json"),
    "utf-8",
  ),
);

describe("même découpe que le moteur Python", () => {
  for (const c of SHARED) {
    it(c.name, () => {
      const pauses = pauseAfter(c.words, c.times, c.pause_s);
      const stops = signStops(c.words);
      expect([...pauses].sort((a, b) => a - b)).toEqual(c.pauses);
      expect([...stops].sort((a, b) => a - b)).toEqual(c.stops);
      expect(
        chunkRanges(c.times, c.start_s, c.max_s, c.min_s, pauses, stops),
      ).toEqual(c.chunks);
    });
  }
});

const WORD = "كلمة";
const timeline = (durations: number[]): [number, number][] => {
  let at = 0;
  return durations.map((d) => {
    const pair: [number, number] = [at, at + d];
    at += d;
    return pair;
  });
};

describe("pauseAfter / chunkRanges", () => {
  it("trop peu de mots : aucun débit estimable, aucune pause", () => {
    expect(pauseAfter([WORD, WORD], timeline([0.5, 3]), 0.6).size).toBe(0);
  });

  it("des temps de longueur différente de celle des mots : aucune pause", () => {
    expect(pauseAfter([WORD, WORD, WORD], timeline([0.5, 3]), 0.6).size).toBe(
      0,
    );
  });

  it("les morceaux couvrent tous les mots sans trou ni recouvrement", () => {
    const times = timeline([
      0.4, 0.4, 1.4, 0.4, 0.9, 0.4, 0.4, 2, 0.4, 0.4, 0.4,
    ]);
    for (const pauses of [
      new Set<number>(),
      new Set([2, 7]),
      new Set([...times.keys()]),
    ]) {
      const ranges = chunkRanges(times, 0, 4, 0.8, pauses, new Set([4]));
      expect(ranges[0][0]).toBe(0);
      expect(ranges[ranges.length - 1][1]).toBe(times.length);
      ranges.slice(1).forEach((r, k) => expect(r[0]).toBe(ranges[k][1]));
      for (const [i, j] of ranges) expect(i).toBeLessThan(j);
    }
  });
});

const verse = (over: Partial<Interval> = {}): Interval =>
  ({
    kind: "verse",
    ref: "112:4",
    words: [1, 8],
    partial: false,
    status: "recognized",
    t: [10, 14],
    time_interpolated: false,
    confidence: 0.9,
    candidates: [],
    repetition: false,
    text: "a ب ج د ه و ز ح",
    translation: null,
    ...over,
  }) as Interval;

const ARABIC = "كلمة ۚ كلمتان كلمات كلمة كلمة كلمتان كلمة كلمات";
const measured = (durations: number[], start = 10): Partial<Interval> => ({
  t: [start, start + durations.reduce((a, b) => a + b, 0)],
  word_times: timeline(durations).map(([a, b]) => [a + start, b + start]),
  word_times_source: "ctc-alignment",
});

describe("splitVerse", () => {
  const base = {
    text: ARABIC,
    words: [1, 8] as [number, number],
  };

  it("un verset sans pause reste une seule carte", () => {
    const item = verse({
      ...base,
      ...measured([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
    });
    expect(splitVerse(item, DEFAULT_SPLIT)).toHaveLength(1);
  });

  it("coupe là où le récitant s'arrête, sans perdre ni ajouter un mot (I1)", () => {
    const item = verse({
      ...base,
      ...measured([0.5, 0.5, 2.4, 0.5, 0.5, 0.5, 0.5, 0.5]),
    });
    const cards = splitVerse(item, DEFAULT_SPLIT);
    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.arabic).join(" ")).toBe(ARABIC);
    expect(cards[0].start).toBe(10);
    expect(cards[1].start).toBe(cards[0].end); // l'une prend la place de l'autre
    expect(cards[cards.length - 1].end).toBe(item.t![1]);
    expect(cards.map((c) => c.part)).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("un signe d'arrêt reste avec son mot", () => {
    const item = verse({
      ...base,
      ...measured([0.5, 0.5, 2.4, 0.5, 0.5, 0.5, 0.5, 0.5]),
    });
    expect(splitVerse(item, DEFAULT_SPLIT)[0].arabic).toBe(
      "كلمة ۚ كلمتان كلمات",
    );
  });

  it("désactivé, ou temps non mesurés : pas de coupe sur pause", () => {
    const item = verse({
      ...base,
      ...measured([0.5, 0.5, 2.4, 0.5, 0.5, 0.5, 0.5, 0.5]),
    });
    expect(splitVerse(item, { ...DEFAULT_SPLIT, enabled: false })).toHaveLength(
      1,
    );
    const estimated = verse({
      ...base,
      ...measured([0.5, 0.5, 2.4, 0.5, 0.5, 0.5, 0.5, 0.5]),
      word_times_source: "interpolated",
    });
    expect(splitVerse(estimated, DEFAULT_SPLIT)).toHaveLength(1);
  });

  it("un long verset sans pause est coupé au plafond, au prorata s'il n'a pas de temps de mots", () => {
    const item = verse({ ...base, t: [0, 20] });
    const cards = splitVerse(item, DEFAULT_SPLIT);
    expect(cards.length).toBeGreaterThan(1);
    expect(cards.map((c) => c.arabic).join(" ")).toBe(ARABIC);
    expect(cards[0].start).toBe(0);
    expect(cards[cards.length - 1].end).toBe(20);
  });

  it("le nombre de mots du texte ne correspond pas à la plage : la carte reste entière", () => {
    const item = verse({
      ...base,
      words: [1, 5],
      ...measured([0.5, 0.5, 2.4, 0.5, 0.5]),
    });
    expect(splitVerse(item, DEFAULT_SPLIT)).toHaveLength(1);
  });

  it("la traduction suit les tranches de QuranEnc, rejointes elles redonnent le texte (I2)", () => {
    const item = verse({
      ...base,
      ...measured([0.5, 0.5, 2.4, 0.5, 0.5, 0.5, 0.5, 0.5]),
      translation: {
        text: "Premier temps. Second temps.",
        translation_id: "fr.hamidullah",
        version: "1",
        attribution: "Muhammad Hamidullah",
        scope: "verse",
        segments: [
          { words: [1, 3], text: "Premier temps." },
          { words: [4, 8], text: "Second temps." },
        ],
      },
    });
    const cards = splitVerse(item, DEFAULT_SPLIT);
    expect(cards.map((c) => c.translation)).toEqual([
      "Premier temps.",
      "Second temps.",
    ]);
    expect(cards.some((c) => c.approximate)).toBe(false);
  });

  it("une proposition plus longue qu'une carte est partagée par les coupures fines (phrases)", () => {
    const item = verse({
      ...base,
      ...measured([0.5, 0.5, 2.4, 0.5, 0.5, 0.5, 0.5, 0.5]),
      translation: {
        text: "Allah! Point de divinité, le Vivant.",
        translation_id: "fr.hamidullah",
        version: "1",
        attribution: "Muhammad Hamidullah",
        scope: "verse",
        segments: [{ words: [1, 8], text: "Allah! Point de divinité, le Vivant." }],
        phrases: [
          { words: [1, 3], text: "Allah!" },
          { words: [4, 8], text: "Point de divinité, le Vivant." },
        ],
      },
    });
    const cards = splitVerse(item, DEFAULT_SPLIT);
    expect(cards.map((c) => c.translation)).toEqual([
      "Allah!",
      "Point de divinité, le Vivant.",
    ]);
  });

  it("une phrase va dans la carte qui porte la majorité de ses mots arabes", () => {
    const item = verse({
      ...base,
      ...measured([0.5, 0.5, 2.4, 0.5, 0.5, 0.5, 0.5, 0.5]),
      translation: {
        text: "Allah! Point de divinité. Fin.",
        translation_id: "fr.hamidullah",
        version: "1",
        attribution: "Muhammad Hamidullah",
        scope: "verse",
        phrases: [
          { words: [1, 2], text: "Allah!" },
          { words: [3, 6], text: "Point de divinité." },
          { words: [7, 8], text: "Fin." },
        ],
        segments: [{ words: [1, 8], text: "Allah! Point de divinité. Fin." }],
      },
    });
    const cards = splitVerse(item, DEFAULT_SPLIT);
    expect(cards.map((c) => c.translation)).toEqual([
      "Allah!",
      "Point de divinité. Fin.",
    ]);
  });

  it("sans tranches, la traduction est coupée au prorata des mots et le dit", () => {
    const item = verse({
      ...base,
      ...measured([0.5, 0.5, 2.4, 0.5, 0.5, 0.5, 0.5, 0.5]),
      translation: {
        text: "un deux trois quatre cinq six sept huit",
        translation_id: "fr.hamidullah",
        version: "1",
        attribution: "Muhammad Hamidullah",
        scope: "verse",
      },
    });
    const cards = splitVerse(item, DEFAULT_SPLIT);
    expect(cards.map((c) => c.translation).join(" ")).toBe(
      "un deux trois quatre cinq six sept huit",
    );
    expect(cards.every((c) => c.approximate)).toBe(true);
  });

  it("une traduction de fragment est découpée dans sa plage seulement", () => {
    const item = verse({
      ...base,
      ...measured([0.5, 0.5, 2.4, 0.5, 0.5, 0.5, 0.5, 0.5]),
      translation: {
        text: "tout le verset",
        translation_id: "fr.hamidullah",
        version: "1",
        attribution: "Muhammad Hamidullah",
        scope: "fragment",
        fragment: { text: "début fin", words: [1, 8] },
        segments: [
          { words: [1, 3], text: "début" },
          { words: [4, 8], text: "fin" },
          { words: [9, 12], text: "hors plage" },
        ],
      },
    });
    const cards = splitVerse(item, DEFAULT_SPLIT);
    expect(cards.map((c) => c.translation)).toEqual(["début", "fin"]);
  });
});

describe("coupe de la traduction au prorata", () => {
  it("arrondit comme le moteur Python : la moitié va au pair (5 mots × 4/8 = 2,5 → 2)", () => {
    const item = verse({
      text: ARABIC,
      words: [1, 8],
      ...measured([0.5, 0.5, 0.5, 2.4, 0.5, 0.5, 0.5, 0.5]),
      translation: {
        text: "un deux trois quatre cinq",
        translation_id: "fr.hamidullah",
        version: "1",
        attribution: "Muhammad Hamidullah",
        scope: "verse",
      },
    });
    const cards = splitVerse(item, DEFAULT_SPLIT);
    expect(cards.map((c) => c.translation)).toEqual([
      "un deux",
      "trois quatre cinq",
    ]);
  });
});

describe("robustesse : mille versets tirés au hasard", () => {
  // Générateur déterministe (mulberry32) : un échec se rejoue avec la même graine.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it("les morceaux couvrent toujours tous les mots, dans l'ordre, sans en perdre", () => {
    const next = rng(2026);
    for (let run = 0; run < 1000; run++) {
      const n = 1 + Math.floor(next() * 40);
      const times = timeline(Array.from({ length: n }, () => 0.1 + next() * 3));
      const pauses = new Set<number>();
      const stops = new Set<number>();
      for (let k = 0; k < n - 1; k++) {
        if (next() < 0.2) pauses.add(k);
        if (next() < 0.2) stops.add(k);
      }
      const maxS = 0.5 + next() * 20;
      const minS = next() * Math.min(maxS, 5);
      const ranges = chunkRanges(times, 0, maxS, minS, pauses, stops);
      expect(ranges[0][0]).toBe(0);
      expect(ranges[ranges.length - 1][1]).toBe(n);
      ranges.slice(1).forEach((r, k) => expect(r[0]).toBe(ranges[k][1]));
      for (const [i, j] of ranges) expect(j).toBeGreaterThan(i);
    }
  });

  it("pauseAfter ne lève jamais et ne désigne jamais le dernier mot", () => {
    const next = rng(7);
    for (let run = 0; run < 500; run++) {
      const n = Math.floor(next() * 30);
      const words = Array.from({ length: n }, () => WORD);
      const times = timeline(Array.from({ length: n }, () => next() * 4));
      for (const k of pauseAfter(words, times, 0.2 + next() * 3)) {
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThan(n - 1);
      }
    }
  });
});
