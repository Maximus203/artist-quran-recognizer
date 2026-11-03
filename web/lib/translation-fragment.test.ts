import { describe, expect, it } from "vitest";
import {
  activePartIndex,
  translationDisplay,
  type TranslationDisplay,
} from "./translation-fragment";
import type { Interval } from "./recognition";
import {
  INTERVAL_3,
  INTERVAL_3_LEGACY,
  INTERVAL_4,
  TRANSLATION_LEGACY,
  TRANSLATION_SEGMENTED,
  VERSE_TRANSLATION_TEXT,
} from "./__fixtures__/hud-11-61";

type Tr = NonNullable<Extract<Interval, { kind: "verse" }>["translation"]>;
const tr = (interval: Interval): Tr =>
  (interval as { translation: Tr }).translation;
const joined = (d: TranslationDisplay) => d.parts.map((p) => p.text).join(" ");

describe("traduction du passage (scope: fragment)", () => {
  it("n'affiche que le fragment, avec les points de suspension aux bords", () => {
    const d = translationDisplay(tr(INTERVAL_4));
    expect(d.scope).toBe("fragment");
    expect(d.wordsRange).toEqual([15, 23]);
    expect(d.ellipsisBefore).toBe(true);
    expect(d.ellipsisAfter).toBe(true);
    expect(d.approximate).toBe(true);
    expect(joined(d)).toBe(
      "De la terre Il vous a créé, et Il vous l’a fait peupler (et exploiter). Implorez donc Son pardon, puis repentez-vous à Lui !",
    );
    expect(joined(d)).not.toContain("Thamûd");
  });

  it("la reprise démarre exactement là où le passage repart (pas au début du verset)", () => {
    const first = translationDisplay(tr(INTERVAL_3));
    const retake = translationDisplay(tr(INTERVAL_4));
    expect(joined(first).startsWith("Vous n’avez point")).toBe(true);
    expect(joined(retake).startsWith("De la terre")).toBe(true);
  });

  it("découpe le fragment en segments quand ils recomposent exactement son texte", () => {
    const d = translationDisplay(tr(INTERVAL_4));
    expect(d.highlightable).toBe(true);
    expect(d.parts.map((p) => p.segment)).toEqual([3, 4, 5]);
  });

  it("n'altère jamais le texte : les points de suspension ne sont pas dans les morceaux", () => {
    const d = translationDisplay(tr(INTERVAL_4));
    expect(d.parts.some((p) => p.text.includes("…"))).toBe(false);
  });

  it("garde le fragment entier, sans découpage, s'il ne recompose pas les segments", () => {
    const odd = {
      ...tr(INTERVAL_4),
      fragment: {
        ...tr(INTERVAL_4).fragment!,
        text: "Une portion approximative",
      },
    } as Tr;
    const d = translationDisplay(odd);
    expect(d.scope).toBe("fragment");
    expect(d.parts).toEqual([
      { text: "Une portion approximative", segment: null, words: null },
    ]);
    expect(d.highlightable).toBe(false);
  });

  it("lit les points de suspension au niveau de la traduction si le fragment n'en porte pas", () => {
    const base = tr(INTERVAL_4);
    const d = translationDisplay({
      ...base,
      ellipsis_before: true,
      ellipsis_after: false,
      fragment: { words: base.fragment!.words, text: base.fragment!.text },
    } as Tr);
    expect(d.ellipsisBefore).toBe(true);
    expect(d.ellipsisAfter).toBe(false);
    expect(d.approximate).toBe(false);
  });
});

describe("repli sur la traduction du verset entier", () => {
  it("scope « verse » : traduction entière, étiquette conservée", () => {
    const d = translationDisplay({ ...tr(INTERVAL_3), scope: "verse" } as Tr);
    expect(d.scope).toBe("verse");
    expect(d.wordsRange).toBeNull();
    expect(d.ellipsisBefore).toBe(false);
    expect(joined(d)).toBe(VERSE_TRANSLATION_TEXT);
  });

  it("champs absents (ancien moteur) : le texte reçu, tel quel, en un morceau", () => {
    const d = translationDisplay(tr(INTERVAL_3_LEGACY));
    expect(d.scope).toBe("verse");
    expect(d.parts).toEqual([
      { text: TRANSLATION_LEGACY.text, segment: null, words: null },
    ]);
    expect(d.highlightable).toBe(false);
  });

  it("scope « fragment » sans fragment utilisable : repli sur le verset entier", () => {
    const noFragment = { ...tr(INTERVAL_4), fragment: undefined } as Tr;
    expect(translationDisplay(noFragment).scope).toBe("verse");
    const emptyFragment = {
      ...tr(INTERVAL_4),
      fragment: { words: [15, 23], text: "   " },
    } as Tr;
    expect(translationDisplay(emptyFragment).scope).toBe("verse");
    const inverted = {
      ...tr(INTERVAL_4),
      fragment: { words: [23, 15], text: "x" },
    } as Tr;
    expect(translationDisplay(inverted).scope).toBe("verse");
  });

  it("verset entier avec segments qui recomposent le texte : un morceau par segment", () => {
    const d = translationDisplay(TRANSLATION_SEGMENTED as unknown as Tr);
    expect(d.scope).toBe("verse");
    expect(d.highlightable).toBe(true);
    expect(d.parts).toHaveLength(7);
    expect(joined(d)).toBe(VERSE_TRANSLATION_TEXT);
  });

  it("segments qui ne recomposent pas le texte : aucun morceau surlignable", () => {
    const d = translationDisplay({
      ...TRANSLATION_SEGMENTED,
      segments: [{ words: [1, 27], text: "Autre chose" }],
    } as unknown as Tr);
    expect(d.highlightable).toBe(false);
    expect(d.parts).toHaveLength(1);
    expect(d.parts[0].text).toBe(TRANSLATION_LEGACY.text);
  });

  it("segments malformés (plage inversée, texte vide) : ignorés", () => {
    const d = translationDisplay({
      ...TRANSLATION_SEGMENTED,
      segments: [{ words: [5, 1], text: "x" }],
    } as unknown as Tr);
    expect(d.highlightable).toBe(false);
  });
});

describe("activePartIndex : mot → morceau de traduction", () => {
  const d = translationDisplay(tr(INTERVAL_4));

  it("trouve le segment qui contient le mot", () => {
    expect(activePartIndex(d, 15)).toBe(0); // « De la terre… » (mots 14-17)
    expect(activePartIndex(d, 17)).toBe(0);
    expect(activePartIndex(d, 18)).toBe(1);
    expect(activePartIndex(d, 23)).toBe(2);
  });

  it("n'invente rien pour un mot hors segments ou sans découpage", () => {
    expect(activePartIndex(d, 3)).toBe(-1);
    expect(activePartIndex(d, 99)).toBe(-1);
    expect(activePartIndex(translationDisplay(tr(INTERVAL_3_LEGACY)), 12)).toBe(
      -1,
    );
  });
});
