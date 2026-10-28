/**
 * Les plages d'un export vidéo telles que l'humain les compose sur la frise (« signets ») : une
 * liste ordonnée, une vidéo par plage. Les raccourcis (tout l'audio, un verset = une vidéo,
 * ajouter ce verset) REMPLISSENT cette liste ; les marges viennent TOUJOURS de `suggestRanges`
 * (`export-video-suggest.ts`, source unique du souffle partagée avec l'API et le rendu).
 *
 * Une plage automatique suit le souffle quand on le change ; une plage retouchée à la main
 * (`auto: false`) ne bouge plus. Les noms par défaut sont les références du résultat (I1) ; un
 * passage incertain n'est jamais proposé (I3).
 */
import { round3 } from "./export-timeline";
import { MAX_RANGES, type ExportRange } from "./export-video-ranges";
import {
  suggestRanges,
  type SuggestedRange,
  type SuggestPeaks,
  type SuggestTiming,
} from "./export-video-suggest";

export type Padding = { before: number; after: number; snap: boolean };

export type PlanRange = ExportRange & {
  id: number;
  /** Nom de la plage (sert au nom du fichier) ; vide = intervalle. */
  name: string;
  /** Suit le souffle tant qu'elle n'a pas été retouchée. */
  auto: boolean;
  /** Début de la récitation du verset d'origine (plage automatique d'un verset), sinon null. */
  anchor: number | null;
};

export type PlanContext = {
  intervals: readonly SuggestTiming[];
  duration: number;
  peaks: SuggestPeaks | null;
  padding: Padding;
};

export const WHOLE_AUDIO_NAME = "Tout l’audio";

/** Plages protégées, une par verset proposé (reconnu ou déduit, jamais incertain). */
export function suggestions(ctx: PlanContext): SuggestedRange[] {
  return suggestRanges(ctx.intervals, ctx.duration, ctx.peaks, {
    leadIn: ctx.padding.before,
    tailOut: ctx.padding.after,
    snapToSilence: ctx.padding.snap,
    group: "verse",
    includeInferred: true,
  });
}

/** « 2:255 », « 2:255-257 », « 2:286-3:1 » : uniquement les références du résultat. */
export function nameFromRefs(refs: readonly string[]): string {
  if (refs.length === 0) return "";
  const first = refs[0];
  const last = refs[refs.length - 1];
  if (refs.length === 1 || first === last) return first;
  const [s1] = first.split(":");
  const [s2, v2] = last.split(":");
  return s1 === s2 && v2 !== undefined ? `${first}-${v2}` : `${first}-${last}`;
}

const fromSuggestion = (s: SuggestedRange, id: number): PlanRange => ({
  id,
  start: round3(s.start),
  end: round3(s.end),
  name: nameFromRefs(s.refs),
  auto: true,
  anchor: s.core_start,
});

export function wholeAudio(ctx: PlanContext, id: number): PlanRange {
  return {
    id,
    start: 0,
    end: round3(ctx.duration),
    name: WHOLE_AUDIO_NAME,
    auto: true,
    anchor: null,
  };
}

export const isWhole = (range: ExportRange, duration: number): boolean =>
  range.start <= 0.001 && range.end >= duration - 0.001;

/** « Un verset = une vidéo » : identifiants consécutifs à partir de `firstId`. */
export function fromSuggestions(ctx: PlanContext, firstId: number): PlanRange[] {
  return suggestions(ctx)
    .slice(0, MAX_RANGES)
    .map((s, i) => fromSuggestion(s, firstId + i));
}

/** Le verset proposé qui contient (à la tolérance près) l'instant `t`, sinon null. */
function suggestionAt(
  ctx: PlanContext,
  t: number,
  tolerance = 0.3,
): SuggestedRange | null {
  return (
    suggestions(ctx).find(
      (s) => t >= s.core_start - tolerance && t <= s.core_end + tolerance,
    ) ?? null
  );
}

/** Le passage le plus proche du centre de la loupe : le premier qui finit après `t`, sinon le dernier. */
export function suggestionNear(
  ctx: PlanContext,
  t: number,
): SuggestedRange | null {
  const all = suggestions(ctx);
  return all.find((s) => s.core_end > t) ?? all[all.length - 1] ?? null;
}

/** Ajoute la plage protégée du verset à l'instant `t` (même liste si rien à ajouter ou liste pleine). */
export function addVerse(
  ranges: PlanRange[],
  ctx: PlanContext,
  t: number,
  id: number,
): PlanRange[] {
  if (ranges.length >= MAX_RANGES) return ranges;
  const s = suggestionAt(ctx, t);
  return s ? [...ranges, fromSuggestion(s, id)] : ranges;
}

/** Les plages automatiques suivent un nouveau souffle ; les autres ne bougent pas. */
export function reflow(ranges: PlanRange[], ctx: PlanContext): PlanRange[] {
  const all = suggestions(ctx);
  return ranges.map((range) => {
    if (!range.auto || range.anchor === null) return range;
    const match = all.find((s) => Math.abs(s.core_start - range.anchor!) < 1e-3);
    return match
      ? { ...range, start: round3(match.start), end: round3(match.end) }
      : range;
  });
}

const swap = (ranges: PlanRange[], i: number, j: number): PlanRange[] => {
  if (i < 0 || j < 0 || i >= ranges.length || j >= ranges.length) return ranges;
  const next = [...ranges];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
};
export const moveUp = (ranges: PlanRange[], id: number): PlanRange[] => {
  const i = ranges.findIndex((r) => r.id === id);
  return i <= 0 ? ranges : swap(ranges, i, i - 1);
};
export const moveDown = (ranges: PlanRange[], id: number): PlanRange[] => {
  const i = ranges.findIndex((r) => r.id === id);
  return i < 0 || i === ranges.length - 1 ? ranges : swap(ranges, i, i + 1);
};
export const removeRange = (ranges: PlanRange[], id: number): PlanRange[] =>
  ranges.filter((r) => r.id !== id);

type Timed = SuggestTiming & { t: [number, number] };
const timedVerses = (intervals: readonly SuggestTiming[]): Timed[] =>
  intervals.filter(
    (i): i is Timed => i.kind === "verse" && !!i.t && i.t[1] > i.t[0],
  );

/** Ce que la ligne d'une plage dit d'elle : passages, à vérifier, voix coupée, chevauchement. */
export function rangeFacts(
  range: PlanRange,
  intervals: readonly SuggestTiming[],
  all: readonly PlanRange[],
): {
  verses: number;
  toCheck: number;
  cutsVoice: boolean;
  overlapsWith: number | null;
} {
  const verses = timedVerses(intervals).filter(
    (v) => v.t[1] > range.start && v.t[0] < range.end,
  );
  const inside = (time: number, v: Timed) => time > v.t[0] && time < v.t[1];
  const cutsVoice = timedVerses(intervals).some(
    (v) => inside(range.start, v) || inside(range.end, v),
  );
  const other = all.findIndex(
    (o) => o.id !== range.id && o.start < range.end && o.end > range.start,
  );
  return {
    verses: verses.length,
    toCheck: verses.filter((v) => v.status !== "recognized").length,
    cutsVoice,
    overlapsWith: other < 0 ? null : other + 1,
  };
}

/** Repères de l'aimant et des touches [ ] : bords protégés de chaque verset proposé, triés. */
export function snapTargets(ctx: PlanContext): number[] {
  return suggestions(ctx)
    .flatMap((s) => [s.start, s.end])
    .sort((a, b) => a - b);
}

/** Le passage (verset, quel que soit son statut) sous l'instant `t`, sinon null. */
export function verseAt(
  intervals: readonly SuggestTiming[],
  t: number,
  tolerance = 0,
): SuggestTiming | null {
  return (
    timedVerses(intervals).find(
      (v) => t >= v.t[0] - tolerance && t <= v.t[1] + tolerance,
    ) ?? null
  );
}

export const totalSeconds = (ranges: readonly ExportRange[]): number =>
  ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
