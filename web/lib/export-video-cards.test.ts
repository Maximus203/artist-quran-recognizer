import { describe, expect, it } from "vitest";
import type { Interval } from "./recognition";
import { videoCardInputs } from "./export-video-cards";

const verse = (over: Partial<Interval> = {}): Interval =>
  ({
    kind: "verse",
    ref: "2:255",
    words: [1, 4],
    partial: false,
    status: "recognized",
    t: [10, 20],
    time_interpolated: false,
    confidence: 0.9,
    candidates: [],
    repetition: false,
    text: "اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ",
    translation: {
      text: "Allah ! Point de divinité à part Lui.",
      translation_id: "fr.hamidullah",
      attribution: "Muhammad Hamidullah",
      version: "1",
      scope: "whole",
    },
    ...over,
  }) as Interval;

describe("videoCardInputs", () => {
  it("ne garde que les versets avec texte arabe et temps", () => {
    const intervals = [
      verse(),
      verse({ ref: "2:256", text: null }), // pas de texte : pas de carte
      verse({ ref: null, t: null }), // pas de référence ni de temps
      {
        kind: "non_quran",
        t: [30, 35],
        label: "commentaire",
      } as unknown as Interval,
      {
        kind: "abstention",
        t: [36, 38],
        reason: "silence",
      } as unknown as Interval,
    ];
    const cards = videoCardInputs(intervals);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      start: 10,
      end: 20,
      refLabel: "Al-Baqara 2:255",
    });
  });

  it("préfère le fragment de traduction aligné sur le passage", () => {
    const card = videoCardInputs([
      verse({
        translation: {
          text: "verset entier",
          translation_id: "fr.hamidullah",
          attribution: "Muhammad Hamidullah",
          version: "1",
          scope: "fragment",
          fragment: { text: "fragment du passage", words: [1, 4] },
        },
      }),
    ])[0];
    expect(card.translation).toBe("fragment du passage");
  });

  it("n'affiche pas de traduction sans attribut : honnêteté de la source (I2)", () => {
    const card = videoCardInputs([verse({ translation: undefined })])[0];
    expect(card.translation).toBeNull();
    expect(card.attribution).toBeNull();
  });
});
