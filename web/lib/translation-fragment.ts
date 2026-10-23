/**
 * Quelle traduction montrer pour la plage de mots affichée en arabe, et quel morceau surligner quand
 * un mot est récité. Fonctions pures.
 *
 * INVARIANT I2 : le texte QuranEnc n'est JAMAIS modifié. On choisit ce qu'on montre (le fragment du
 * moteur, ou la traduction entière), on le découpe en morceaux seulement quand les segments du
 * moteur le recomposent exactement (aux espaces près), et les points de suspension (…) sont un décor
 * d'affichage qui n'entre dans aucun morceau. Honnêteté : quand on ne sait pas aligner, on montre le
 * texte reçu en un seul morceau et rien n'est surligné mot à mot.
 */
import type { Interval } from "./recognition";

type VerseInterval = Extract<Interval, { kind: "verse" }>;
export type TranslationInput = NonNullable<VerseInterval["translation"]>;

export type TranslationPart = {
  text: string;
  /** Indice dans `translation.segments`, `null` si le morceau n'est pas un segment du moteur. */
  segment: number | null;
  /** Plage de mots du segment, `null` hors segment. */
  words: [number, number] | null;
};

export type TranslationDisplay = {
  /** `fragment` : seule la portion du passage ; `verse` : la traduction du verset entier. */
  scope: "fragment" | "verse";
  parts: TranslationPart[];
  /** Les morceaux sont des segments du moteur : on peut surligner celui du mot en cours. */
  highlightable: boolean;
  /** Plage de mots que couvre le fragment (pour « Traduction du passage (mots a–b) »). */
  wordsRange: [number, number] | null;
  ellipsisBefore: boolean;
  ellipsisAfter: boolean;
  approximate: boolean;
};

type Segment = { words: [number, number]; text: string };

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

const isRange = (words: unknown): words is [number, number] =>
  Array.isArray(words) &&
  words.length === 2 &&
  Number.isInteger(words[0]) &&
  Number.isInteger(words[1]) &&
  words[0] >= 1 &&
  words[0] <= words[1];

/** Segments bien formés, sinon `null` : une seule entrée douteuse invalide le découpage. */
function validSegments(
  segments: TranslationInput["segments"],
): Segment[] | null {
  if (!segments || segments.length === 0) return null;
  for (const segment of segments)
    if (!isRange(segment.words) || normalize(segment.text) === "") return null;
  return segments as Segment[];
}

const recomposes = (parts: readonly string[], text: string): boolean =>
  normalize(parts.join(" ")) === normalize(text);

function wholeVerse(
  translation: TranslationInput,
  segments: Segment[] | null,
): TranslationDisplay {
  const aligned =
    segments &&
    recomposes(
      segments.map((s) => s.text),
      translation.text,
    );
  return {
    scope: "verse",
    parts:
      aligned && segments
        ? segments.map((s, i) => ({ text: s.text, segment: i, words: s.words }))
        : [{ text: translation.text, segment: null, words: null }],
    highlightable: Boolean(aligned),
    wordsRange: null,
    ellipsisBefore: false,
    ellipsisAfter: false,
    approximate: false,
  };
}

export function translationDisplay(
  translation: TranslationInput,
): TranslationDisplay {
  const segments = validSegments(translation.segments);
  const fragment = translation.fragment;
  if (
    translation.scope !== "fragment" ||
    !fragment ||
    !isRange(fragment.words) ||
    normalize(fragment.text) === ""
  )
    return wholeVerse(translation, segments);

  const [first, last] = fragment.words;
  const overlapping = segments
    ? segments
        .map((segment, index) => ({ segment, index }))
        .filter(
          ({ segment }) =>
            segment.words[1] >= first && segment.words[0] <= last,
        )
    : [];
  const aligned =
    overlapping.length > 0 &&
    recomposes(
      overlapping.map(({ segment }) => segment.text),
      fragment.text,
    );
  return {
    scope: "fragment",
    parts: aligned
      ? overlapping.map(({ segment, index }) => ({
          text: segment.text,
          segment: index,
          words: segment.words,
        }))
      : [{ text: fragment.text, segment: null, words: null }],
    highlightable: aligned,
    wordsRange: [first, last],
    ellipsisBefore:
      fragment.ellipsis_before ?? translation.ellipsis_before ?? false,
    ellipsisAfter:
      fragment.ellipsis_after ?? translation.ellipsis_after ?? false,
    approximate: fragment.approximate ?? false,
  };
}

/**
 * Indice du morceau affiché qui contient le mot `word` (numéro dans le verset), -1 si le découpage
 * n'est pas surlignable ou si aucun segment ne couvre ce mot.
 */
export function activePartIndex(
  display: TranslationDisplay,
  word: number,
): number {
  if (!display.highlightable) return -1;
  return display.parts.findIndex(
    (part) =>
      part.words !== null && part.words[0] <= word && word <= part.words[1],
  );
}
