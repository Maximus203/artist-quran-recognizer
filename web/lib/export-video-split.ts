/**
 * Découpe d'un verset en plusieurs cartes de la vidéo d'export : là où le récitant s'arrête, et
 * pas au-delà de `maxS` d'affichage. Fonctions pures, sans canvas ni React. C'est la même règle que
 * le moteur Python des sous-titres (`src/aqr/export/cues.py`) ; les deux lisent les mêmes cas
 * (`tests/fixtures/export-pauses/cases.json`).
 *
 * Les temps au mot de l'alignement forcé sont contigus (le silence qui suit un mot lui appartient) :
 * une pause se lit à l'allongement d'un mot au-delà du débit du verset, pas à un trou. Sans temps
 * mesurés, aucune pause n'est inventée : seule la limite `maxS` coupe, au prorata des lettres, avec
 * une préférence pour un signe d'arrêt du Mushaf.
 *
 * INVARIANT I1 : l'arabe n'est que découpé aux frontières de mots (chaque mot garde ses signes), la
 * concaténation des cartes redonne le texte du corpus. I2 : la traduction n'est que découpée, jamais
 * réécrite ; la coupe par tranches de QuranEnc est exacte, la coupe au prorata est signalée
 * (`approximate`).
 */
import { layoutArabicWords, validateWordTimes } from "./live-highlight";
import type { Interval } from "./recognition";

export type SplitOptions = {
  enabled: boolean;
  /** Durée d'affichage maximale d'une carte (s) ; un mot seul peut la dépasser. */
  maxS: number;
  /** Durée minimale d'une carte (s) ; une carte plus courte est rattachée à sa voisine. */
  minS: number;
  /** Silence (s) à partir duquel c'est une pause. */
  pauseS: number;
};

export const DEFAULT_SPLIT: SplitOptions = {
  enabled: true,
  maxS: 7,
  minS: 1,
  pauseS: 0.6,
};

/** Signes où l'on peut s'arrêter : ۗ ۘ ۚ ۛ. Ni ۙ (ne pas s'arrêter) ni ۖ (mieux vaut continuer). */
const STOP_SIGNS = /[ۗۘۚۛ]/u;
/** Au plafond, un signe n'est préféré que si le morceau couvre au moins cette part de `maxS`. */
const MIN_CAP_SHARE = 0.5;

export type Times = readonly (readonly [number, number])[];

const letterWeight = (word: string): number =>
  Math.max(1, (word.match(/\p{L}/gu) ?? []).length);

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Arrondi au plus proche, la moitié allant au pair : celui de Python (`round`), pour la parité. */
function roundHalfEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Indices (0-based) des mots après lesquels le récitant s'arrête. Le débit est la médiane des
 * secondes par lettre ; le silence d'un mot est son excédent sur ce débit plus le trou qui le
 * sépare du suivant. Un madd très long peut dépasser le seuil : la coupe ne change que l'affichage.
 */
export function pauseAfter(
  words: readonly string[],
  times: Times,
  pauseS: number,
): Set<number> {
  const out = new Set<number>();
  if (words.length < 3 || times.length !== words.length) return out;
  const weights = words.map(letterWeight);
  const rate = median(times.map(([a, b], k) => (b - a) / weights[k]));
  for (let k = 0; k < words.length - 1; k++) {
    const [start, end] = times[k];
    const excess = Math.max(0, end - start - rate * weights[k]);
    const gap = Math.max(0, times[k + 1][0] - end);
    if (excess + gap >= pauseS) out.add(k);
  }
  return out;
}

/** Indices des mots suivis d'un signe d'arrêt permis (pas le dernier : le verset finit). */
export function signStops(words: readonly string[]): Set<number> {
  const out = new Set<number>();
  words.slice(0, -1).forEach((word, k) => {
    if (STOP_SIGNS.test(word)) out.add(k);
  });
  return out;
}

/**
 * Plages de mots `[i, j)` : coupées après chaque mot de `pauses`, et d'au plus `maxS` chacune. Au
 * plafond, on coupe de préférence après un mot de `stops` si le morceau couvre au moins la moitié
 * de `maxS`. Une plage plus courte que `minS` est rattachée à sa voisine (la précédente, sinon la
 * suivante).
 */
export function chunkRanges(
  times: Times,
  startS: number,
  maxS: number,
  minS: number,
  pauses: ReadonlySet<number> = new Set(),
  stops: ReadonlySet<number> = new Set(),
): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  while (i < times.length) {
    const begin = out.length === 0 ? startS : times[i][0];
    let j = i + 1;
    while (
      j < times.length &&
      !pauses.has(j - 1) &&
      times[j][1] - begin <= maxS
    )
      j++;
    if (j < times.length && !pauses.has(j - 1)) {
      const fitting = [...stops]
        .filter(
          (k) =>
            i < k + 1 &&
            k + 1 < j &&
            times[k][1] - begin >= MIN_CAP_SHARE * maxS,
        )
        .map((k) => k + 1);
      if (fitting.length > 0) j = Math.max(...fitting);
    }
    out.push([i, j]);
    i = j;
  }
  return absorbShort(out, times, minS);
}

function absorbShort(
  chunks: [number, number][],
  times: Times,
  minS: number,
): [number, number][] {
  const out = chunks.map((c) => [...c] as [number, number]);
  let k = 0;
  while (out.length > 1 && k < out.length) {
    const [first, last] = out[k];
    if (times[last - 1][1] - times[first][0] >= minS) {
      k++;
      continue;
    }
    if (k === 0) {
      out.splice(0, 2, [first, out[1][1]]);
    } else {
      out.splice(k - 1, 2, [out[k - 1][0], last]);
      k--;
    }
  }
  return out;
}

export type SplitCard = {
  start: number;
  end: number;
  arabic: string;
  translation: string | null;
  /** Vrai si la traduction a été coupée au prorata des mots (pas par les tranches de QuranEnc). */
  approximate: boolean;
  /** Rang de la carte et nombre de cartes du verset ; absent quand le verset n'est pas coupé. */
  part?: [number, number];
  /** Mots du verset affichés par cette carte, `[premier, fin exclue)` à partir de 0 ; absent si entier. */
  range?: [number, number];
};

const blank = (text: string | null | undefined) => !text || /^\s*$/.test(text);

/** La traduction du passage entier : le fragment aligné sur le passage s'il existe. */
function shownTranslation(item: Interval): string | null {
  if (item.kind !== "verse" || !item.translation) return null;
  const { translation } = item;
  const fragment =
    translation.scope === "fragment" ? translation.fragment : undefined;
  const text =
    fragment && !blank(fragment.text) ? fragment.text : translation.text;
  return blank(text) ? null : text;
}

function translationPieces(
  item: Interval,
  ranges: readonly (readonly [number, number])[],
  wordCount: number,
): { pieces: (string | null)[]; approximate: boolean } {
  const shown = shownTranslation(item);
  if (item.kind !== "verse" || shown === null)
    return { pieces: ranges.map(() => null), approximate: false };
  if (ranges.length === 1) return { pieces: [shown], approximate: false };
  const first = item.words?.[0] ?? 1;
  const translation = item.translation!;
  const fragment =
    translation.scope === "fragment" && translation.fragment
      ? translation.fragment
      : undefined;
  const [low, high] = fragment ? fragment.words : [-1, 1_000_000];
  const segments = (translation.segments ?? []).filter(
    ({ words }) => words[0] >= low && words[0] <= high,
  );
  if (segments.length > 0) {
    const buckets = ranges.map(() => "");
    for (const { words, text } of segments) {
      const absolute = Math.min(
        Math.max(words[0], first),
        first + wordCount - 1,
      );
      const slot = ranges.findIndex(
        ([i, j]) => first + i <= absolute && absolute <= first + j - 1,
      );
      if (slot >= 0) buckets[slot] = `${buckets[slot]} ${text}`.trim();
    }
    return {
      pieces: buckets.map((b) => (b === "" ? null : b)),
      approximate: false,
    };
  }
  const tokens = shown.split(/\s+/).filter(Boolean);
  return {
    pieces: ranges.map(([i, j]) => {
      const part = tokens
        .slice(
          roundHalfEven((tokens.length * i) / wordCount),
          roundHalfEven((tokens.length * j) / wordCount),
        )
        .join(" ");
      return part === "" ? null : part;
    }),
    approximate: true,
  };
}

/** Les cartes d'un verset : une seule si rien ne justifie de le couper. `[]` si ce n'est pas un verset affichable. */
export function splitVerse(item: Interval, options: SplitOptions): SplitCard[] {
  if (item.kind !== "verse" || !item.t || blank(item.text)) return [];
  const [start, end] = item.t;
  const whole: SplitCard = {
    start,
    end,
    arabic: item.text!,
    translation: shownTranslation(item),
    approximate: false,
  };
  if (!options.enabled || !item.words) return [whole];
  const { parts, wordCount } = layoutArabicWords(item.text!);
  if (wordCount === 0 || wordCount !== item.words[1] - item.words[0] + 1)
    return [whole];
  const words = parts.filter((p) => p.word !== null).map((p) => p.text);

  const given = validateWordTimes(item.words, item.word_times);
  let times: Times;
  if (given) {
    times = given;
  } else {
    const weights = words.map(letterWeight);
    const total = weights.reduce((a, b) => a + b, 0);
    let passed = 0;
    let cursor = start;
    times = weights.map((weight, k) => {
      passed += weight;
      const stop =
        k === weights.length - 1
          ? end
          : start + ((end - start) * passed) / total;
      const pair: [number, number] = [cursor, stop];
      cursor = stop;
      return pair;
    });
  }
  const pauses =
    given && item.word_times_source === "ctc-alignment"
      ? pauseAfter(words, times, options.pauseS)
      : new Set<number>();
  const ranges = chunkRanges(
    times,
    start,
    options.maxS,
    options.minS,
    pauses,
    signStops(words),
  );
  if (ranges.length === 1) return [whole];
  const { pieces, approximate } = translationPieces(item, ranges, wordCount);
  return ranges.map(([i, j], k) => ({
    start: k === 0 ? start : times[i][0],
    end: k === ranges.length - 1 ? end : times[j][0],
    arabic: words.slice(i, j).join(" "),
    translation: pieces[k],
    approximate: approximate && pieces[k] !== null,
    part: [k + 1, ranges.length],
    range: [i, j],
  }));
}
