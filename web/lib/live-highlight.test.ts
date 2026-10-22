import { describe, expect, it } from "vitest";
import {
  currentWordIndex,
  layoutArabicWords,
  liveWords,
  validateWordTimes,
  wordTimesOf,
} from "./live-highlight";
import { shownIndex } from "./passage";
import type { Interval } from "./recognition";
import {
  INTERVAL_3,
  INTERVAL_3_LEGACY,
  INTERVAL_4,
  SESSION_SLICE,
} from "./__fixtures__/hud-11-61";

const times = [
  [1, 2],
  [2, 3.5],
  [4, 5],
  [5, 6],
] as const;

describe("currentWordIndex", () => {
  it("trouve le mot dont l'intervalle contient l'instant", () => {
    expect(currentWordIndex(times, 1)).toBe(0);
    expect(currentWordIndex(times, 1.99)).toBe(0);
    expect(currentWordIndex(times, 2)).toBe(1);
    expect(currentWordIndex(times, 4.5)).toBe(2);
    expect(currentWordIndex(times, 5.5)).toBe(3);
  });

  it("n'invente aucun mot avant le premier", () => {
    expect(currentWordIndex(times, 0)).toBe(-1);
    expect(currentWordIndex(times, 0.999)).toBe(-1);
  });

  it("garde le dernier mot dit dans un silence entre deux mots et après le dernier", () => {
    expect(currentWordIndex(times, 3.7)).toBe(1);
    expect(currentWordIndex(times, 99)).toBe(3);
  });

  it("se recale instantanément quand le temps revient en arrière (seek, boucle, reprise)", () => {
    expect(currentWordIndex(times, 5.5)).toBe(3);
    expect(currentWordIndex(times, 1.2)).toBe(0);
    expect(currentWordIndex(times, 4.1)).toBe(2);
  });

  it("gère une liste vide et un seul mot", () => {
    expect(currentWordIndex([], 3)).toBe(-1);
    expect(currentWordIndex([[2, 3]], 2.5)).toBe(0);
    expect(currentWordIndex([[2, 3]], 1)).toBe(-1);
  });

  it("sur des mots de durée nulle, prend le dernier qui a commencé", () => {
    expect(
      currentWordIndex(
        [
          [1, 1],
          [1, 1],
          [1, 2],
        ],
        1,
      ),
    ).toBe(2);
  });

  it("refuse un instant non fini", () => {
    expect(currentWordIndex(times, Number.NaN)).toBe(-1);
  });
});

describe("validateWordTimes (aucun faux surlignage : en cas de doute, pas de temps au mot)", () => {
  it("accepte des temps bien formés, un couple par mot", () => {
    expect(
      validateWordTimes(
        [10, 12],
        [
          [1, 2],
          [2, 3],
          [3, 4],
        ],
      ),
    ).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  it("refuse l'absence, un mauvais nombre de couples ou une forme inattendue", () => {
    expect(validateWordTimes([10, 12], undefined)).toBeNull();
    expect(validateWordTimes([10, 12], null)).toBeNull();
    expect(validateWordTimes([10, 12], [[1, 2]])).toBeNull();
    expect(validateWordTimes([10, 11], [[1, 2], [2]])).toBeNull();
    expect(validateWordTimes([10, 11], "oops")).toBeNull();
    expect(validateWordTimes(null, [[1, 2]])).toBeNull();
  });

  it("refuse des bornes non finies, inversées ou négatives", () => {
    expect(
      validateWordTimes(
        [1, 2],
        [
          [1, 2],
          [Number.NaN, 3],
        ],
      ),
    ).toBeNull();
    expect(
      validateWordTimes(
        [1, 2],
        [
          [1, 2],
          [3, 2.5],
        ],
      ),
    ).toBeNull();
    expect(
      validateWordTimes(
        [1, 2],
        [
          [-1, 2],
          [2, 3],
        ],
      ),
    ).toBeNull();
  });

  it("refuse des débuts qui reculent (l'ordre des mots est celui du temps)", () => {
    expect(
      validateWordTimes(
        [1, 2],
        [
          [3, 4],
          [2, 5],
        ],
      ),
    ).toBeNull();
  });
});

describe("wordTimesOf / liveWords", () => {
  it("lit les temps d'un verset du moteur", () => {
    expect(wordTimesOf(INTERVAL_3)?.length).toBe(8);
  });

  it("n'en a pas pour un ancien résultat, une basmala ou une abstention", () => {
    expect(wordTimesOf(INTERVAL_3_LEGACY)).toBeNull();
    expect(wordTimesOf(SESSION_SLICE[0])).toBeNull();
  });

  it("n'active le surlignage des mots que si le texte arabe s'aligne sur la plage de mots", () => {
    const live = liveWords(INTERVAL_3);
    expect(live?.first).toBe(10);
    expect(live?.parts.filter((p) => p.word !== null)).toHaveLength(8);
    expect(live?.source).toBe("ctc-alignment");
    // texte tronqué : 8 temps mais 7 mots lus → aucun surlignage de mot
    const broken = {
      ...(INTERVAL_3 as Record<string, unknown>),
      text: "لَكُم مِّنْ إِلَـٰهٍ",
    } as Interval;
    expect(liveWords(broken)).toBeNull();
  });
});

describe("layoutArabicWords", () => {
  it("rend exactement le texte du corpus quand on remet les morceaux bout à bout", () => {
    const text = INTERVAL_3.kind === "verse" ? (INTERVAL_3.text ?? "") : "";
    const layout = layoutArabicWords(text);
    expect(layout.parts.map((p) => p.text).join("")).toBe(text);
  });

  it("rattache un signe de pause (ۖ) au mot qui le précède, sans le compter comme un mot", () => {
    const layout = layoutArabicWords("غَيْرُهُۥ ۖ هُوَ");
    expect(layout.wordCount).toBe(2);
    expect(layout.parts[0]).toEqual({ text: "غَيْرُهُۥ ۖ", word: 0 });
  });

  it("rattache un signe en tête au premier mot", () => {
    const layout = layoutArabicWords("۞ قَالَ يَا");
    expect(layout.wordCount).toBe(2);
    expect(layout.parts.map((p) => p.text).join("")).toBe("۞ قَالَ يَا");
    expect(layout.parts[0].word).toBe(0);
  });

  it("conserve les espaces de début et de fin et accepte le vide", () => {
    expect(layoutArabicWords("").parts).toEqual([]);
    const spaced = layoutArabicWords(" قَالَ ");
    expect(spaced.parts.map((p) => p.text).join("")).toBe(" قَالَ ");
    expect(spaced.wordCount).toBe(1);
  });
});

describe("reprise dans un même verset (11:61, intervalles 3 → 4)", () => {
  const slice = SESSION_SLICE;
  const live = (t: number) => {
    const index = shownIndex(slice, null, t);
    const item = index >= 0 ? slice[index] : null;
    const wt = item ? wordTimesOf(item) : null;
    return { index, word: wt ? currentWordIndex(wt, t) : -1 };
  };

  it("suit le mot dans le passage 3, puis change de passage pour la reprise", () => {
    expect(live(36.0)).toEqual({ index: 1, word: 0 });
    expect(live(46)).toEqual({ index: 1, word: 7 });
    expect(live(55.4)).toEqual({ index: 2, word: 0 });
    expect(live(70)).toEqual({ index: 2, word: 5 });
  });

  it("revient au passage 3 et à son mot exact quand le temps recule", () => {
    expect(live(70).index).toBe(2);
    expect(live(40)).toEqual({ index: 1, word: 3 });
    expect(live(36.9)).toEqual({ index: 1, word: 1 });
  });

  it("n'affiche aucun mot entre deux passages (le silence avant la reprise)", () => {
    expect(live(50)).toEqual({ index: -1, word: -1 });
  });
});
