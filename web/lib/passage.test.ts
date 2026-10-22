import { describe, expect, it } from "vitest";
import {
  activeIndex,
  describePassage,
  filterIntervals,
  intervalLabel,
  intervalStateLabel,
  intervalStyle,
  shownIndex,
  splitNoteMarkers,
  toArabicIndic,
} from "./passage";
import type { Interval } from "./recognition";

const translation = {
  text: "Allah! Point de divinité à part Lui.[1]",
  translation_id: "french_hameedullah",
  version: "v1",
  attribution: "QuranEnc.com — Hamidullah",
  scope: "verse" as const,
};
const verse = (over: Record<string, unknown> = {}): Interval =>
  ({
    kind: "verse",
    ref: "2:255",
    words: null,
    partial: false,
    status: "recognized",
    t: [58.5, 101.2],
    time_interpolated: false,
    confidence: 0.9,
    candidates: [],
    repetition: false,
    text: "ٱللَّهُ لَآ إِلَـٰهَ إِلَّا هُوَ",
    translation,
    ...over,
  }) as Interval;
const nonQuran = (
  label: string,
  over: Record<string, unknown> = {},
): Interval => ({ kind: "non_quran", label, t: [0, 4.2], ...over }) as Interval;
const abstention = (reason: string): Interval =>
  ({
    kind: "abstention",
    reason,
    t: [52, 58.5],
    best_score: null,
  }) as Interval;

describe("toArabicIndic", () => {
  it("écrit les chiffres arabes d'un numéro de verset", () => {
    expect(toArabicIndic(255)).toBe("٢٥٥");
    expect(toArabicIndic("1")).toBe("١");
    expect(toArabicIndic("0")).toBe("٠");
  });
});

describe("splitNoteMarkers (présentation seulement, la chaîne n'est jamais modifiée)", () => {
  it("isole les marqueurs de note [n]", () => {
    expect(
      splitNoteMarkers("Au nom d’Allah.[1] Le Miséricordieux.[2]"),
    ).toEqual([
      { text: "Au nom d’Allah.", note: false },
      { text: "[1]", note: true },
      { text: " Le Miséricordieux.", note: false },
      { text: "[2]", note: true },
    ]);
  });
  it("recompose exactement la chaîne d'origine", () => {
    const original = "A [12] b[3]c [x] d";
    expect(
      splitNoteMarkers(original)
        .map((s) => s.text)
        .join(""),
    ).toBe(original);
  });
  it("laisse un texte sans note tel quel", () => {
    expect(splitNoteMarkers("Rien à signaler")).toEqual([
      { text: "Rien à signaler", note: false },
    ]);
  });
});

describe("describePassage", () => {
  it("rien à cet instant", () => {
    expect(describePassage(null)).toEqual({ type: "empty" });
  });

  it("verset reconnu : texte du corpus, numéro en chiffres arabes, traduction et attribution", () => {
    const model = describePassage(verse());
    expect(model).toMatchObject({
      type: "verse",
      ref: "2:255",
      arabic: "ٱللَّهُ لَآ إِلَـٰهَ إِلَّا هُوَ",
      ayahNumber: "٢٥٥",
      range: [58.5, 101.2],
      badges: ["Reconnu"],
    });
    if (model.type === "verse") {
      expect(model.translation).toEqual({
        text: "Allah! Point de divinité à part Lui.[1]",
        attribution: "QuranEnc.com — Hamidullah",
        translationId: "french_hameedullah",
        version: "v1",
        partialNote: false,
      });
    }
  });

  it("verset partiel : pas de médaillon de fin de verset, badge et mention de traduction entière", () => {
    const model = describePassage(verse({ partial: true, words: [1, 3] }));
    expect(model).toMatchObject({ type: "verse", ayahNumber: null });
    if (model.type === "verse") {
      expect(model.badges).toContain("Passage partiel");
      expect(model.translation?.partialNote).toBe(true);
    }
  });

  it("répétition et temps interpolé en badges", () => {
    const model = describePassage(
      verse({ repetition: true, time_interpolated: true }),
    );
    if (model.type !== "verse") throw new Error("verset attendu");
    expect(model.badges).toEqual(["Reconnu", "Répétition", "Temps interpolé"]);
  });

  it("verset reconnu sans texte dans le résultat", () => {
    expect(
      describePassage(verse({ text: null, translation: null })),
    ).toMatchObject({ type: "verse_no_text", ref: "2:255" });
  });

  it("hypothèse : jamais entendue, pas de texte", () => {
    expect(
      describePassage(
        verse({ status: "inferred", text: null, translation: null }),
      ),
    ).toMatchObject({ type: "hypothesis", ref: "2:255" });
  });

  it("incertain : références candidates", () => {
    expect(
      describePassage(
        verse({
          status: "uncertain",
          ref: null,
          candidates: ["2:256", "2:257"],
          text: null,
          translation: null,
        }),
      ),
    ).toMatchObject({ type: "uncertain", candidates: ["2:256", "2:257"] });
  });

  it("formules : constantes de l'interface, jamais le Mushaf", () => {
    const model = describePassage(nonQuran("[isti'adha]"));
    expect(model).toMatchObject({ type: "formula" });
    if (model.type === "formula") expect(model.formula.id).toBe("istiadha");
    expect(describePassage(nonQuran("[takbir]"))).toMatchObject({
      type: "formula",
    });
    expect(describePassage(nonQuran("[amin]"))).toMatchObject({
      type: "formula",
    });
  });

  it("autre parole non coranique", () => {
    expect(describePassage(nonQuran("[french]"))).toMatchObject({
      type: "other_speech",
      label: "[french]",
    });
  });

  it("basmala d'un ancien résultat (étiquette sans texte)", () => {
    expect(describePassage(nonQuran("[basmala]"))).toMatchObject({
      type: "basmala",
      arabic: null,
      translation: null,
    });
  });

  it("basmala portée par un non_quran qui contient le texte du corpus", () => {
    const model = describePassage(
      nonQuran("[basmala]", {
        basmala: true,
        text: "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
        translation: { ...translation, text: "Au nom d’Allah.[1]" },
      }),
    );
    expect(model).toMatchObject({
      type: "basmala",
      arabic: "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
    });
    if (model.type === "basmala")
      expect(model.translation?.text).toBe("Au nom d’Allah.[1]");
  });

  it("basmala portée par un verset (champ basmala) : même carte, sans médaillon", () => {
    const model = describePassage(
      verse({ ref: "1:1", basmala: true, text: "بِسْمِ ٱللَّهِ" }),
    );
    expect(model).toMatchObject({ type: "basmala", arabic: "بِسْمِ ٱللَّهِ" });
  });

  it("abstention : motif lisible", () => {
    expect(describePassage(abstention("below_threshold"))).toMatchObject({
      type: "abstention",
      reason: "Score insuffisant",
    });
    expect(describePassage(abstention("silence"))).toMatchObject({
      reason: "Silence selon le moteur",
    });
  });
});

describe("libellés des intervalles", () => {
  it("intervalLabel", () => {
    expect(intervalLabel(verse())).toBe("2:255");
    expect(
      intervalLabel(
        verse({
          status: "uncertain",
          ref: null,
          candidates: ["2:256", "2:257"],
        }),
      ),
    ).toBe("Références possibles : 2:256 · 2:257");
    expect(intervalLabel(nonQuran("[isti'adha]"))).toBe("Isti’adha");
    expect(intervalLabel(nonQuran("[french]"))).toBe("[french]");
    expect(intervalLabel(abstention("no_candidate"))).toBe(
      "Aucune correspondance",
    );
    expect(intervalLabel(verse({ basmala: true, ref: "1:1" }))).toBe("Basmala");
  });
  it("intervalStateLabel et intervalStyle suivent les mêmes codes que la légende", () => {
    expect(intervalStateLabel(verse())).toBe("Reconnu");
    expect(intervalStateLabel(verse({ status: "inferred" }))).toBe(
      "Déduit · non entendu",
    );
    expect(intervalStateLabel(verse({ status: "uncertain" }))).toBe(
      "Incertain",
    );
    expect(intervalStateLabel(nonQuran("[takbir]"))).toBe("Formule");
    expect(intervalStateLabel(abstention("silence"))).toBe("Abstention");
    expect(intervalStyle(verse())).toBe("recognized");
    expect(intervalStyle(verse({ status: "inferred" }))).toBe("inferred");
    expect(intervalStyle(verse({ status: "uncertain" }))).toBe("uncertain");
    expect(intervalStyle(nonQuran("[takbir]"))).toBe("formula");
    expect(intervalStyle(abstention("silence"))).toBe("abstention");
  });
});

describe("activeIndex / shownIndex (quel intervalle la carte affiche)", () => {
  const list = [
    nonQuran("[isti'adha]", { t: [0, 4] }),
    verse({ t: [4, 12] }),
    abstention("silence"),
    verse({ t: [20, 30], ref: "2:256" }),
  ];
  it("trouve l'intervalle qui couvre l'instant, formules comprises", () => {
    expect(activeIndex(list, 1)).toBe(0);
    expect(activeIndex(list, 5)).toBe(1);
    expect(activeIndex(list, 25)).toBe(3);
  });
  it("renvoie -1 hors de tout intervalle, et ignore ceux sans temps", () => {
    expect(activeIndex(list, 15)).toBe(-1);
    expect(activeIndex(list, 99)).toBe(-1);
    const noTime = [{ ...verse(), t: null } as unknown as Interval];
    expect(activeIndex(noTime, 1)).toBe(-1);
  });
  it("la fin d'un intervalle est exclue (pas de chevauchement avec le suivant)", () => {
    expect(activeIndex(list, 4)).toBe(1);
  });
  it("shownIndex garde l'intervalle choisi tant que la lecture est dedans", () => {
    expect(shownIndex(list, 3, 25)).toBe(3);
  });
  it("shownIndex suit la lecture dès qu'elle sort de l'intervalle choisi", () => {
    expect(shownIndex(list, 3, 5)).toBe(1);
  });
  it("un intervalle choisi sans temps reste affiché", () => {
    const noTime = [{ ...verse(), t: null } as unknown as Interval];
    expect(shownIndex(noTime, 0, 50)).toBe(0);
  });
  it("sans choix : l'intervalle courant, ou -1", () => {
    expect(shownIndex(list, null, 5)).toBe(1);
    expect(shownIndex(list, null, 15)).toBe(-1);
  });
});

describe("filterIntervals", () => {
  const list = [
    verse(),
    verse({ status: "uncertain", ref: null }),
    verse({ status: "inferred" }),
    nonQuran("[amin]"),
    abstention("silence"),
  ];
  const indexes = (filter: string) =>
    filterIntervals(list, filter).map((entry) => entry.index);
  it("Tous, Versets, À revoir, Formules, Abstentions", () => {
    expect(indexes("all")).toEqual([0, 1, 2, 3, 4]);
    expect(indexes("verse")).toEqual([0, 1, 2]);
    expect(indexes("uncertain")).toEqual([1, 2]);
    expect(indexes("non_quran")).toEqual([3]);
    expect(indexes("abstention")).toEqual([4]);
  });
  it("garde l'indice d'origine de chaque intervalle", () => {
    expect(filterIntervals(list, "abstention")[0].index).toBe(4);
  });
});
