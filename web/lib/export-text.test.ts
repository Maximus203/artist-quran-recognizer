import { describe, expect, it } from "vitest";
import {
  bytesFr,
  clock,
  decisionLabel,
  differingWords,
  nonQuranSentence,
  omissionText,
  plural,
  ranges,
  verdictSentence,
  why,
  wordsLabel,
} from "./export-text";
import type { CandidateView, ReadinessItem } from "./export-types";

const token = (text: string, diff = false) => ({ text, diff });
const candidates = (flags: boolean[][]): CandidateView[] =>
  ["11:61", "7:73"].map((ref, n) => ({
    ref,
    words: [1, flags[n].length],
    words_total: 27,
    tokens: flags[n].map((d, i) => token(`mot${i}`, d)),
    translation: null,
    translation_scope: null,
  }));
const base: ReadinessItem = {
  key: "k",
  type: "uncertain",
  index: 1,
  fingerprint: "f",
  t: [48.2, 62.6],
  ref: "11:61",
  words: [1, 10],
  impact: "arabic_sign",
  effective: true,
  state: "open",
  decision: null,
  review_ids: [],
  related_reports: [],
};

describe("formats", () => {
  it("horloge au dixième, tailles et pluriels", () => {
    expect(clock(48.2)).toBe("00:48.2");
    expect(clock(62.6)).toBe("01:02.6");
    expect(clock(3599.96)).toBe("60:00.0");
    expect(bytesFr(900)).toBe("900 o");
    expect(bytesFr(6350)).toBe("6,2 Ko");
    expect(plural(1, "passage", "passages")).toBe("1 passage");
    expect(plural(5, "passage", "passages")).toBe("5 passages");
    expect(wordsLabel([5, 5])).toBe("mot 5");
    expect(wordsLabel([11, 17])).toBe("mots 11–17");
  });
  it("regroupe des positions consécutives", () => {
    expect(ranges([3, 4, 5, 9])).toEqual([
      [3, 5],
      [9, 9],
    ]);
    expect(ranges([])).toEqual([]);
  });
});

describe("pourquoi un passage est à vérifier", () => {
  it("un signe de pause seulement : le numéro du mot", () => {
    const c = candidates([
      [false, false, false, false, true],
      [false, false, false, false, true],
    ]);
    expect(differingWords(c)).toEqual([5]);
    expect(why({ ...base, candidates: c })).toBe(
      "2 candidats : 11:61 ou 7:73. Mêmes lettres ; un seul signe de pause diffère au mot 5.",
    );
  });
  it("des lettres qui diffèrent : la plage de mots", () => {
    const c = candidates([
      [false, true, true, true],
      [false, true, true, true],
    ]);
    expect(why({ ...base, impact: "arabic", candidates: c })).toContain(
      "L'arabe diffère aux mots 2–4.",
    );
  });
  it("même arabe : traduction ou référence", () => {
    const c = candidates([[false], [false]]);
    expect(why({ ...base, impact: "translation", candidates: c })).toContain(
      "seule la traduction diffère",
    );
    expect(why({ ...base, impact: "reference", candidates: c })).toContain(
      "seule la référence diffère",
    );
  });
  it("une coupure dit ce qui manque", () => {
    expect(
      why({
        ...base,
        type: "cut",
        ref: "17:74",
        words: [1, 3],
        words_total: 9,
        sides: ["end"],
      }),
    ).toContain("la fin (mots 4–9)");
    expect(
      why({
        ...base,
        type: "cut",
        ref: "17:74",
        words: [4, 9],
        words_total: 9,
        sides: ["start"],
      }),
    ).toContain("le début (mots 1–3)");
  });
  it("un supposé n'est pas exporté tant qu'on ne l'a pas confirmé", () => {
    expect(why({ ...base, type: "inferred" })).toContain("jamais entendu");
  });
  it("aucun jargon technique à l'écran", () => {
    const sentences = [
      why({ ...base, type: "inferred" }),
      why({
        ...base,
        type: "approx",
        translation: { verse: "", fragment: "", fragment_words: [9, 17] },
      }),
      why({
        ...base,
        type: "report",
        notes: [
          {
            id: "x",
            tester: "Amina",
            tags: ["wrong_verse"],
            description: "",
            expected_ref: null,
            t: [1, 2],
          },
        ],
      }),
    ].join(" ");
    expect(sentences).not.toMatch(
      /interval|status|INFERRED|fingerprint|uncertain/i,
    );
    expect(sentences).toContain("Amina");
    expect(sentences).toContain("Verset faux");
  });
});

describe("décisions et verdict", () => {
  const decision = (kind: string, value: object) => ({ kind, value }) as never;
  it("dit la décision en français", () => {
    expect(
      decisionLabel(decision("choose", { ref: "11:61", words: [1, 10] })),
    ).toBe("11:61 · mots 1–10");
    expect(decisionLabel(decision("exclude", { reason: "not_quran" }))).toBe(
      "pas du Coran, exclu",
    );
    expect(decisionLabel(decision("ignore", {}))).toContain("règle par défaut");
    expect(
      decisionLabel(decision("translation_scope", { scope: "none" })),
    ).toBe("sans traduction");
  });
  it("le verdict sépare l'arabe du reste", () => {
    expect(verdictSentence({ arabic: 4, other: 1 })).toBe(
      "4 touchent l'arabe ; 1 concerne seulement la traduction ou la référence.",
    );
    expect(verdictSentence({ arabic: 1, other: 0 })).toBe("1 touche l'arabe.");
    expect(verdictSentence({ arabic: 0, other: 0 })).toBe("");
  });
  it("les passages non coraniques sont comptés à part", () => {
    expect(nonQuranSentence({ abstentions: 6, formulas: 3 })).toEqual({
      total: 9,
      detail: "6 abstentions : tafsir, wolof, français · 3 formules",
    });
    expect(nonQuranSentence({ abstentions: 0, formulas: 1 }).detail).toBe(
      "1 formule",
    );
  });
  it("dit pourquoi un passage est omis", () => {
    expect(
      omissionText({ reason: "uncertain", ref: null, detail: "11:61 | 7:73" }),
    ).toBe("11:61 ou 7:73 est incertain.");
    expect(
      omissionText({ reason: "inferred", ref: "112:3", detail: null }),
    ).toContain("112:3 est un verset supposé");
  });
});
