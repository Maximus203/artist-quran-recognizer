/**
 * ADR-0031 : DÉSACTIVÉE par défaut (`DEFAULT_SPLIT.enabled === false`). Un verset est une seule carte,
 * arabe et traduction entiers, tout son intervalle. Ce module ne sert que si l'option est explicitement
 * activée.
 *
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
 * réécrite. ADR-0027 : on ne coupe qu'à la fin d'une tranche exacte de QuranEnc ; sans tranches
 * exactes, jamais de coupe au prorata, le verset reste entier (surligné mot à mot).
 */
import { layoutArabicWords, validateWordTimes } from "./live-highlight";
import type { Interval } from "./recognition";

export type SplitOptions = {
  /** Faux par défaut (ADR-0031) : un verset = une carte entière ; la coupe n'existe que derrière cette option. */
  enabled: boolean;
  /** Durée d'affichage maximale d'une carte (s) ; un mot seul peut la dépasser. */
  maxS: number;
  /** Durée minimale d'une carte (s) ; une carte plus courte est rattachée à sa voisine. */
  minS: number;
  /** Silence (s) à partir duquel c'est une pause. */
  pauseS: number;
};

export const DEFAULT_SPLIT: SplitOptions = {
  enabled: false,
  maxS: 7,
  minS: 1,
  pauseS: 0.9,
};

/** Durée minimale d'une carte issue d'une coupe (ADR-0027) : plus conservateur que `minS`. */
export const MIN_CARD_S = 2;

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
  /** Toujours faux depuis ADR-0027 (plus de coupe au prorata) ; champ gardé pour les appelants. */
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

type Slice = { words: readonly [number, number]; text: string };

/**
 * Ne garde des coupes que celles où une tranche de traduction exacte finit (ADR-0027). `spans` sont
 * les plages de mots arabes (numérotées dans le verset, bornes comprises) des tranches QuranEnc ;
 * `firstWord` est le numéro du premier mot du passage. Une coupe est permise si aucune tranche ne la
 * chevauche : chaque carte porte alors des tranches entières, jamais un morceau de tranche. Si les
 * tranches ne couvrent pas tous les mots (ou n'existent pas), la traduction ne peut pas suivre
 * l'arabe : le verset reste d'un bloc. Même règle que `align_to_segments` (Python).
 */
export function alignToSegments(
  ranges: readonly (readonly [number, number])[],
  spans: readonly (readonly [number, number])[],
  firstWord: number,
  wordCount: number,
): [number, number][] {
  if (ranges.length <= 1) return ranges.map(([i, j]) => [i, j]);
  const whole: [number, number][] = [[0, wordCount]];
  for (let k = 0; k < wordCount; k++) {
    const word = firstWord + k;
    if (!spans.some(([lo, hi]) => lo <= word && word <= hi)) return whole;
  }
  const kept = [0];
  for (const [, end] of ranges.slice(0, -1)) {
    const boundary = firstWord + end;
    if (!spans.some(([lo, hi]) => lo < boundary && boundary <= hi))
      kept.push(end);
  }
  kept.push(wordCount);
  return kept.slice(1).map((end, k) => [kept[k], end] as [number, number]);
}

/** Les tranches exactes de QuranEnc du passage (phrases si elles existent, sinon propositions). */
function exactSlices(item: Interval): Slice[] {
  if (item.kind !== "verse" || !item.translation) return [];
  const { translation } = item;
  const fragment =
    translation.scope === "fragment" && translation.fragment
      ? translation.fragment
      : undefined;
  const [low, high] = fragment ? fragment.words : [-1, 1_000_000];
  return (translation.phrases ?? translation.segments ?? []).filter(
    ({ words }) => words[0] >= low && words[0] <= high,
  );
}

/**
 * Les plages retenues et la traduction de chacune. La traduction suit l'arabe exactement ou pas du
 * tout : on ne coupe qu'à la fin d'une tranche de QuranEnc (jamais de coupe au prorata, I2) ; sans
 * tranches exactes, ou si une carte resterait sans traduction, le verset reste entier.
 */
function translationPieces(
  item: Interval,
  ranges: readonly (readonly [number, number])[],
  wordCount: number,
): { ranges: [number, number][]; pieces: (string | null)[] } {
  const shown = shownTranslation(item);
  const same = ranges.map(([i, j]) => [i, j] as [number, number]);
  if (item.kind !== "verse" || shown === null)
    return { ranges: same, pieces: ranges.map(() => null) };
  const entire = {
    ranges: [[0, wordCount]] as [number, number][],
    pieces: [shown],
  };
  if (ranges.length === 1) return { ranges: same, pieces: [shown] };
  const first = item.words?.[0] ?? 1;
  const slices = exactSlices(item);
  const aligned = alignToSegments(
    ranges,
    slices.map(({ words }) => words),
    first,
    wordCount,
  );
  if (aligned.length <= 1) return entire;
  const buckets = aligned.map(() => "");
  for (const { words, text } of slices) {
    // Aucune tranche ne chevauche une coupe : la carte est celle qui contient son début.
    const start = Math.max(words[0], first);
    let slot = aligned.findIndex(
      ([i, j]) => first + i <= start && start < first + j,
    );
    if (slot < 0) slot = 0;
    buckets[slot] = `${buckets[slot]} ${text}`.trim();
  }
  if (buckets.some((b) => b === "")) return entire;
  return { ranges: aligned, pieces: buckets };
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
  const cut = chunkRanges(
    times,
    start,
    options.maxS,
    Math.max(options.minS, MIN_CARD_S),
    pauses,
    signStops(words),
  );
  if (cut.length === 1) return [whole];
  const { ranges, pieces } = translationPieces(item, cut, wordCount);
  if (ranges.length === 1) return [whole];
  return ranges.map(([i, j], k) => ({
    start: k === 0 ? start : times[i][0],
    end: k === ranges.length - 1 ? end : times[j][0],
    arabic: words.slice(i, j).join(" "),
    translation: pieces[k],
    approximate: false,
    part: [k + 1, ranges.length],
    range: [i, j],
  }));
}
