/**
 * Surlignage en direct : quel MOT du passage affiché est en train d'être récité, à partir du temps de
 * lecture et des temps de mots du moteur (`word_times`). Fonctions pures, sans React ni DOM.
 *
 * INVARIANT I1 : le texte arabe vient du résultat (corpus) ; ici on ne fait que le DÉCOUPER en mots,
 * en conservant chaque caractère : la concaténation des morceaux redonne exactement le texte.
 * Honnêteté : sans temps de mots valides (absents, mal formés, nombre différent du nombre de mots,
 * texte qui ne s'aligne pas sur la plage de mots), aucun mot n'est surligné — l'appelant retombe sur
 * un marquage du passage entier, jamais sur un mot deviné.
 */
import type { Interval } from "./recognition";

/** `[début_s, fin_s]` de chaque mot de la plage affichée, dans l'ordre de lecture. */
export type WordTimes = readonly (readonly [number, number])[];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * Temps de mots exploitables, sinon `null`. Exige un couple fini `[début, fin]` par mot de
 * `words`, `0 ≤ début ≤ fin`, et des débuts qui ne reculent jamais (l'ordre des mots est celui du
 * temps : c'est ce qui rend la recherche binaire juste).
 */
export function validateWordTimes(
  words: readonly [number, number] | null | undefined,
  times: unknown,
): WordTimes | null {
  if (!words || !Array.isArray(times)) return null;
  if (times.length !== words[1] - words[0] + 1) return null;
  let previousStart = -Infinity;
  for (const pair of times) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !isFiniteNumber(pair[0]) ||
      !isFiniteNumber(pair[1]) ||
      pair[0] < 0 ||
      pair[1] < pair[0] ||
      pair[0] < previousStart
    )
      return null;
    previousStart = pair[0];
  }
  return times as unknown as WordTimes;
}

const cache = new WeakMap<object, WordTimes | null>();

/** Temps de mots validés d'un intervalle (mémorisés : appelé à chaque image de la lecture). */
export function wordTimesOf(item: Interval): WordTimes | null {
  if (item.kind !== "verse") return null;
  const known = cache.get(item);
  if (known !== undefined) return known;
  const valid = validateWordTimes(item.words, item.word_times);
  cache.set(item, valid);
  return valid;
}

/**
 * Indice (dans `times`) du mot en cours à l'instant `t` : le dernier mot dont le début est ≤ `t`.
 * Un silence entre deux mots, ou l'après-dernier mot, garde le dernier mot dit ; avant le premier
 * mot, -1. Recherche binaire sans état : un retour en arrière (seek, boucle, reprise) se recale
 * instantanément, sans mémoire à réinitialiser.
 */
export function currentWordIndex(times: WordTimes, t: number): number {
  if (!isFiniteNumber(t) || times.length === 0 || t < times[0][0]) return -1;
  let low = 0;
  let high = times.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (times[mid][0] <= t) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** Un morceau du texte arabe : un mot (avec ses signes de pause) ou un blanc entre deux mots. */
export type ArabicPart = {
  text: string;
  /** Rang du mot dans la plage affichée (0 = premier mot affiché), `null` pour un blanc. */
  word: number | null;
};

/**
 * Découpe un texte du Mushaf en mots. Un signe de pause ou de récitation isolé (ۖ ۚ ۞ …) est séparé
 * par une espace dans le corpus mais n'est pas un mot : il se rattache au mot précédent (ou, en tête,
 * au suivant). Une « lettre » (`\p{L}`) caractérise un vrai mot.
 */
export function layoutArabicWords(text: string): {
  parts: ArabicPart[];
  wordCount: number;
} {
  const parts: ArabicPart[] = [];
  let wordCount = 0;
  let pendingSpace = "";
  let lead = "";
  for (const token of text.split(/(\s+)/)) {
    if (token === "") continue;
    if (/^\s+$/.test(token)) {
      pendingSpace = token;
      continue;
    }
    const last = parts[parts.length - 1];
    if (!/\p{L}/u.test(token)) {
      if (last && last.word !== null) {
        last.text += pendingSpace + token;
      } else {
        lead += pendingSpace + token;
      }
      pendingSpace = "";
      continue;
    }
    if (lead) {
      parts.push({ text: lead + pendingSpace + token, word: wordCount++ });
    } else {
      if (pendingSpace) parts.push({ text: pendingSpace, word: null });
      parts.push({ text: token, word: wordCount++ });
    }
    pendingSpace = "";
    lead = "";
  }
  // Un signe resté en tête sans mot derrière lui, ou des blancs de fin : rien n'est perdu.
  if (lead) parts.push({ text: lead, word: null });
  if (pendingSpace) parts.push({ text: pendingSpace, word: null });
  return { parts, wordCount };
}

export type LiveWords = {
  parts: ArabicPart[];
  times: WordTimes;
  /** Numéro (dans le verset) du premier mot affiché : `words[0]`. */
  first: number;
  source: "ctc-alignment" | "interpolated" | null;
};

/**
 * Mots surlignables d'un verset : seulement si les temps de mots sont valides ET que le texte arabe
 * contient exactement autant de mots que la plage `words`. Sinon `null` (repli sur le passage).
 */
export function liveWords(item: Interval): LiveWords | null {
  if (item.kind !== "verse" || !item.words || !item.text) return null;
  const times = wordTimesOf(item);
  if (!times) return null;
  const layout = layoutArabicWords(item.text);
  if (layout.wordCount !== times.length) return null;
  return {
    parts: layout.parts,
    times,
    first: item.words[0],
    source: item.word_times_source ?? null,
  };
}

/** Numéro de mot dans le verset (1-based) d'un mot affiché. */
export const verseWordNumber = (first: number, wordIndex: number): number =>
  first + wordIndex;

/**
 * Instant vers lequel placer le lecteur pour « commencer à ce mot », borné au passage affiché pour
 * que la carte reste sur le même passage après le saut.
 */
export function seekTimeForWord(
  times: WordTimes,
  wordIndex: number,
  range: readonly [number, number] | null,
): number | null {
  const word = times[wordIndex];
  if (!word) return null;
  if (!range) return word[0];
  return Math.min(Math.max(word[0], range[0]), range[1] - 0.001);
}
