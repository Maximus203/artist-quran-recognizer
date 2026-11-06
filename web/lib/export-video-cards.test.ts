import { describe, expect, it } from "vitest";
import type { Interval } from "./recognition";
import { videoCardInputs, videoCardSources } from "./export-video-cards";
import { FORMULAS } from "./formulas";
import type { TranslatedItem } from "./free-speech";

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

  describe("formules récitées", () => {
    const basmala = {
      kind: "non_quran",
      label: "basmala",
      basmala: true,
      ref: "1:1",
      t: [1, 4],
      text: "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ",
      translation: {
        text: "Au nom d'Allah, le Tout Miséricordieux, le Très Miséricordieux.",
        translation_id: "fr.hamidullah",
        attribution: "Muhammad Hamidullah",
        version: "1",
        scope: "verse",
      },
    } as unknown as Interval;
    const formula = (label: string, t: [number, number]) =>
      ({ kind: "non_quran", label, t }) as unknown as Interval;

    it("la basmala devient une carte avec le texte et la traduction du corpus (I1, I2)", () => {
      const [card] = videoCardInputs([basmala]);
      expect(card).toMatchObject({
        start: 1,
        end: 4,
        refLabel: "Basmala",
        arabic: "بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ",
        translation:
          "Au nom d'Allah, le Tout Miséricordieux, le Très Miséricordieux.",
      });
    });

    it("une basmala sans texte (copie expurgée) ne produit pas de carte", () => {
      expect(
        videoCardInputs([{ ...basmala, text: null } as unknown as Interval]),
      ).toEqual([]);
    });

    it.each([
      ["istiadha", "istiadha"],
      ["isti'adha", "istiadha"],
      ["takbir", "takbir"],
      ["amin", "amin"],
    ] as const)(
      "%s : arabe et traduction constants, jamais attribués à QuranEnc",
      (label, id) => {
        const [card] = videoCardInputs([formula(label, [5, 8])]);
        expect(card).toMatchObject({
          start: 5,
          end: 8,
          refLabel: FORMULAS[id].name,
          arabic: FORMULAS[id].arabic,
          translation: FORMULAS[id].translation,
          attribution: null,
          formula: true,
        });
      },
    );

    it("une parole non coranique inconnue ne produit aucune carte (I4)", () => {
      expect(
        videoCardInputs([
          formula("french", [5, 8]),
          formula("silence", [9, 10]),
        ]),
      ).toEqual([]);
    });

    it("les cartes restent dans l'ordre du temps, sans surlignage mot à mot pour une formule", () => {
      const sources = videoCardSources([formula("istiadha", [0, 2]), verse()]);
      expect(sources.map((s) => s.card.start)).toEqual([0, 10]);
      expect(sources[0].range).toBeNull();
    });
  });

  describe("parole libre", () => {
    const speech = {
      kind: "non_quran",
      label: "arabic_speech",
      t: [20, 26],
    } as unknown as Interval;
    const item = (index: number): [number, TranslatedItem] => [
      index,
      {
        index,
        t: [20, 26],
        status: "translated",
        transcript_ar: "اليوم نتحدث عن الصبر",
        translation_fr: "Aujourd'hui nous parlons de la patience.",
        confidence: 0.9,
        language: "ar",
        review: "approved",
      },
    ];

    it("sans option : aucune carte pour une parole libre", () => {
      expect(videoCardInputs([verse(), speech])).toHaveLength(1);
    });

    it("avec un passage validé : une carte automatique, sans référence ni attribution", () => {
      const cards = videoCardInputs(
        [verse(), speech],
        undefined,
        new Map([item(1)]),
      );
      expect(cards).toHaveLength(2);
      expect(cards[1]).toMatchObject({
        start: 20,
        end: 26,
        refLabel: "Parole hors Coran · traduction automatique",
        arabic: "اليوم نتحدث عن الصبر",
        translation: "Aujourd'hui nous parlons de la patience.",
        attribution: null,
        automatic: true,
      });
    });

    it("une abstention no_candidate est concernée ; below_threshold reste telle quelle", () => {
      const abstention = (reason: string) =>
        ({ kind: "abstention", reason, t: [20, 26] }) as unknown as Interval;
      const shown = new Map([item(1)]);
      expect(
        videoCardInputs(
          [verse(), abstention("no_candidate")],
          undefined,
          shown,
        ),
      ).toHaveLength(2);
      expect(
        videoCardInputs(
          [verse(), abstention("below_threshold")],
          undefined,
          shown,
        ),
      ).toHaveLength(1);
    });

    it("le rang doit correspondre à une zone arabic_speech (jamais un verset)", () => {
      const cards = videoCardInputs(
        [verse(), speech],
        undefined,
        new Map([item(0)]),
      );
      expect(cards.map((c) => c.refLabel)).toEqual(["Al-Baqara 2:255"]);
    });
  });
});
