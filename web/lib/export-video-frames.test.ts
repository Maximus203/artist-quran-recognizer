import { describe, expect, it } from "vitest";
import type { Interval } from "./recognition";
import {
  VIDEO_FPS,
  activeCardAt,
  frameCountFor,
  frameCards,
  playedBarCount,
  waveBarGeometry,
} from "./export-video-frames";

const verse = (over: Partial<Interval> = {}): Interval =>
  ({
    kind: "verse",
    ref: "2:153",
    words: [1, 4],
    partial: false,
    status: "recognized",
    t: [10, 20],
    time_interpolated: false,
    confidence: 0.9,
    candidates: [],
    repetition: false,
    text: "يَا أَيُّهَا الَّذِينَ آمَنُوا",
    translation: {
      text: "Ô les croyants !",
      translation_id: "fr.hamidullah",
      attribution: "Muhammad Hamidullah",
      version: "1",
      scope: "whole",
    },
    word_times: [
      [10, 12],
      [12, 14],
      [14, 17],
      [17, 20],
    ],
    ...over,
  }) as Interval;

describe("frameCards", () => {
  it("produit une carte par verset avec ses temps de mots", () => {
    const cards = frameCards([verse()], true);
    expect(cards).toHaveLength(1);
    expect(cards[0].card.start).toBe(10);
    expect(cards[0].live?.times).toHaveLength(4);
  });

  it("honore showTranslation : pas de traduction quand désactivé", () => {
    const cards = frameCards([verse()], false);
    expect(cards[0].card.translation).toBeNull();
  });

  it("retombe sur un surlignage nul quand les temps de mots sont absents", () => {
    const cards = frameCards([verse({ word_times: undefined })], true);
    expect(cards[0].live).toBeNull();
  });
});

describe("activeCardAt", () => {
  const cards = frameCards(
    [verse(), verse({ ref: "2:154", t: [30, 40], text: "وَلَا تَقُولُوا" })],
    true,
  );

  it("retourne la carte active à l'instant t, null hors passage", () => {
    expect(activeCardAt(cards, 15)?.card.refLabel).toBe("Al-Baqara 2:153");
    expect(activeCardAt(cards, 35)?.card.refLabel).toContain("2:154");
    expect(activeCardAt(cards, 25)).toBeNull();
    expect(activeCardAt(cards, 5)).toBeNull();
  });
});

describe("playedBarCount / waveBarGeometry / frameCountFor", () => {
  it("borne la partie jouée à l'instant t", () => {
    expect(playedBarCount(100, 0, 40)).toBe(0);
    expect(playedBarCount(100, 20, 40)).toBe(50);
    expect(playedBarCount(100, 40, 40)).toBe(100);
    expect(playedBarCount(100, 999, 40)).toBe(100);
  });

  it("géométrie de l'onde : quart bas, barres espacées comme l'atelier", () => {
    const g = waveBarGeometry(1920, 1080, 25);
    expect(g.zoneY).toBe(810);
    expect(g.zoneH).toBe(270);
    expect(g.bars).toBe(Math.floor(1920 / 4.2));
    expect(g.pitch).toBeCloseTo(1920 / g.bars, 5);
    expect(g.barWidth).toBe(2.6);
  });

  it("nombre de frames : durée × fps, arrondi supérieur, au moins 1", () => {
    expect(frameCountFor(19.02, VIDEO_FPS)).toBe(571);
    expect(frameCountFor(0.01, VIDEO_FPS)).toBe(1);
  });
});
