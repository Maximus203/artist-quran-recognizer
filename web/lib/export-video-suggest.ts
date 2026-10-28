/**
 * Plages d'export suggérées : où couper pour que chaque vidéo contienne un passage ENTIER, sans
 * voix coupée. Le moteur donne, pour chaque verset, le début et la fin de la récitation ; on
 * commence un peu AVANT (marge d'attaque) et on finit un peu APRÈS (marge de fin), et chaque bord
 * est aimanté vers le silence le plus proche (lu dans l'onde de la copie d'écoute), sans jamais
 * entrer dans la récitation voisine. Pur : utilisé par l'API, le MCP, le rendu et le formulaire.
 *
 * Aucun texte ni aucune référence n'est inventé ici : les références viennent des passages du
 * résultat (I1) ; un passage incertain (`uncertain`) n'est jamais nommé (I3).
 */
import type { ExportRange } from "./export-video-ranges";

export type SuggestTiming = {
  kind: string;
  ref?: string | null;
  status?: string;
  t: [number, number] | null;
};

export type SuggestPeaks = {
  per_second: number;
  duration: number;
  peaks: readonly number[];
};

export const DEFAULT_LEAD_IN = 0.6;
export const DEFAULT_TAIL_OUT = 0.4;
export const MAX_PADDING = 5;
/** Au-delà de cet écart entre deux versets, ce sont deux passages distincts (mode « passage »). */
export const DEFAULT_MERGE_GAP = 1;

export type SuggestGroup = "verse" | "passage";

export type SuggestOptions = {
  /** Secondes gardées AVANT le début de la récitation (0 à 5). */
  leadIn?: number;
  /** Secondes gardées APRÈS la fin de la récitation (0 à 5). */
  tailOut?: number;
  /** Aimante chaque bord vers le silence le plus proche (défaut : oui, si l'onde est connue). */
  snapToSilence?: boolean;
  /** `verse` : une plage par verset ; `passage` : les versets enchaînés forment une seule plage. */
  group?: SuggestGroup;
  /** Écart maximal (s) entre deux versets d'un même passage. */
  mergeGap?: number;
  /** Garde aussi les versets `inferred` (déduits de la position) ; défaut oui. */
  includeInferred?: boolean;
};

export type SuggestedRange = ExportRange & {
  index: number;
  /** Récitation seule, sans marge (début du premier verset, fin du dernier). */
  core_start: number;
  core_end: number;
  /** Secondes réellement gardées avant / après la récitation (la marge peut être réduite par un voisin). */
  lead_in: number;
  tail_out: number;
  refs: string[];
  /** Statut de preuve le plus faible du passage : recognized < inferred. */
  status: "recognized" | "inferred";
  snapped: { start: boolean; end: boolean };
  /** À lire avant d'exporter : voisin trop proche, marge réduite, passage très court… */
  warnings: string[];
};

export type Silence = { start: number; end: number };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
const round3 = (value: number): number => Math.round(value * 1000) / 1000;

/** Niveau d'un instant (moyenne glissante courte), ramené entre 0 et 1 par la dynamique de l'audio. */
function levels(peaks: SuggestPeaks): {
  at: (time: number) => number;
  quiet: (time: number) => boolean;
  silences: Silence[];
} {
  const values = peaks.peaks;
  const rate = peaks.per_second;
  if (values.length === 0 || !(rate > 0))
    return { at: () => 0, quiet: () => false, silences: [] };
  const sorted = [...values].sort((a, b) => a - b);
  const low = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.95)] ?? low;
  const span = Math.max(1e-9, high - low);
  const normalized = values.map((v) => clamp((v - low) / span, 0, 1.5));
  // Lissage sur 3 buckets (60 ms à 50/s) : un claquement isolé ne casse pas un silence.
  const smooth = normalized.map((_, i) => {
    const a = normalized[Math.max(0, i - 1)];
    const b = normalized[i];
    const c = normalized[Math.min(normalized.length - 1, i + 1)];
    return (a + b + c) / 3;
  });
  const threshold = 0.12;
  const indexOf = (time: number): number =>
    clamp(Math.floor(time * rate), 0, smooth.length - 1);
  const silences: Silence[] = [];
  let from = -1;
  for (let i = 0; i <= smooth.length; i++) {
    const isQuiet = i < smooth.length && smooth[i] < threshold;
    if (isQuiet && from < 0) from = i;
    if (!isQuiet && from >= 0) {
      if ((i - from) / rate >= 0.15)
        silences.push({ start: round3(from / rate), end: round3(i / rate) });
      from = -1;
    }
  }
  return {
    at: (time) => smooth[indexOf(time)],
    quiet: (time) => smooth[indexOf(time)] < threshold,
    silences,
  };
}

/** Silences (≥ 150 ms) de la copie d'écoute : où une coupe ne tranche aucune voix. */
export function findSilences(peaks: SuggestPeaks): Silence[] {
  return levels(peaks).silences;
}

type Passage = {
  start: number;
  end: number;
  refs: string[];
  status: "recognized" | "inferred";
};

function passagesOf(
  intervals: readonly SuggestTiming[],
  options: Required<Pick<SuggestOptions, "group" | "mergeGap">> & {
    includeInferred: boolean;
  },
): Passage[] {
  const verses: Passage[] = [];
  for (const item of intervals) {
    if (item.kind !== "verse" || !item.t || !item.ref) continue;
    if (item.status === "uncertain") continue;
    if (item.status === "inferred" && !options.includeInferred) continue;
    if (!(item.t[1] > item.t[0])) continue;
    verses.push({
      start: item.t[0],
      end: item.t[1],
      refs: [item.ref],
      status: item.status === "inferred" ? "inferred" : "recognized",
    });
  }
  verses.sort((a, b) => a.start - b.start);
  if (options.group === "verse") return verses;
  const merged: Passage[] = [];
  for (const verse of verses) {
    const last = merged[merged.length - 1];
    if (last && verse.start - last.end <= options.mergeGap) {
      last.end = Math.max(last.end, verse.end);
      last.refs.push(...verse.refs);
      if (verse.status === "inferred") last.status = "inferred";
    } else merged.push({ ...verse, refs: [...verse.refs] });
  }
  return merged;
}

/**
 * Plages à exporter, une par passage, avec marges et aimantation au silence. `peaks` est facultatif :
 * sans onde, les marges s'appliquent sans aimantation.
 */
export function suggestRanges(
  intervals: readonly SuggestTiming[],
  duration: number,
  peaks: SuggestPeaks | null,
  options: SuggestOptions = {},
): SuggestedRange[] {
  const leadIn = clamp(options.leadIn ?? DEFAULT_LEAD_IN, 0, MAX_PADDING);
  const tailOut = clamp(options.tailOut ?? DEFAULT_TAIL_OUT, 0, MAX_PADDING);
  const passages = passagesOf(intervals, {
    group: options.group ?? "verse",
    mergeGap: options.mergeGap ?? DEFAULT_MERGE_GAP,
    includeInferred: options.includeInferred ?? true,
  });
  const wave = peaks ? levels(peaks) : null;
  const snap = (options.snapToSilence ?? true) && wave !== null;
  const out: SuggestedRange[] = [];

  /** Silence le plus proche de `target` dans [from, to] (centre du silence), sinon le point le plus calme. */
  const quietestNear = (
    from: number,
    to: number,
    target: number,
  ): number | null => {
    if (!wave || !(to > from)) return null;
    const step = 0.02;
    let bestQuiet: number | null = null;
    let bestQuietDistance = Infinity;
    let bestLow: number | null = null;
    let bestLevel = Infinity;
    for (let t = from; t <= to + 1e-9; t += step) {
      const level = wave.at(t);
      if (wave.quiet(t)) {
        const distance = Math.abs(t - target);
        if (distance < bestQuietDistance) {
          bestQuietDistance = distance;
          bestQuiet = t;
        }
      }
      if (level < bestLevel - 1e-9) {
        bestLevel = level;
        bestLow = t;
      }
    }
    return bestQuiet ?? bestLow;
  };

  passages.forEach((passage, i) => {
    const previous = passages[i - 1];
    const next = passages[i + 1];
    const warnings: string[] = [];

    // Bornes dures : ne jamais empiéter sur la récitation voisine (on coupe au milieu de l'écart).
    const floor = previous ? (previous.end + passage.start) / 2 : 0;
    const ceil = next ? (passage.end + next.start) / 2 : duration;

    let start = clamp(passage.start - leadIn, floor, passage.start);
    let end = clamp(passage.end + tailOut, passage.end, ceil);
    if (previous && passage.start - previous.end < leadIn + 0.05)
      warnings.push(
        `Le passage précédent finit ${round3(passage.start - previous.end)} s avant : la marge de début est réduite.`,
      );
    if (next && next.start - passage.end < tailOut + 0.05)
      warnings.push(
        `Le passage suivant commence ${round3(next.start - passage.end)} s après : la marge de fin est réduite.`,
      );

    let snappedStart = false;
    let snappedEnd = false;
    if (snap) {
      const s = quietestNear(
        Math.max(floor, start - 0.5),
        Math.max(floor, passage.start - 0.05),
        start,
      );
      if (s !== null && wave && wave.quiet(s)) {
        start = clamp(s, floor, passage.start - 0.02);
        snappedStart = true;
      }
      const e = quietestNear(
        Math.min(ceil, passage.end + 0.05),
        Math.min(ceil, end + 0.5),
        end,
      );
      if (e !== null && wave && wave.quiet(e)) {
        end = clamp(e, passage.end + 0.02, ceil);
        snappedEnd = true;
      }
      if (!snappedStart)
        warnings.push(
          "Aucun silence avant ce passage : la marge est fixe, vérifie le début.",
        );
      if (!snappedEnd)
        warnings.push(
          "Aucun silence après ce passage : la marge est fixe, vérifie la fin.",
        );
    }
    start = clamp(start, 0, duration);
    end = clamp(end, 0, duration);
    if (passage.end - passage.start < 1)
      warnings.push("Passage très court (moins d'une seconde).");
    if (passage.start <= 0.05)
      warnings.push("La récitation commence dès le début de l'audio.");
    if (passage.end >= duration - 0.05)
      warnings.push("La récitation va jusqu'à la fin de l'audio.");

    out.push({
      index: out.length,
      start: round3(start),
      end: round3(end),
      core_start: round3(passage.start),
      core_end: round3(passage.end),
      lead_in: round3(passage.start - start),
      tail_out: round3(end - passage.end),
      refs: passage.refs,
      status: passage.status,
      snapped: { start: snappedStart, end: snappedEnd },
      warnings,
    });
  });
  return out;
}

/**
 * Élargit des plages données (par l'utilisateur ou un agent) avec les mêmes marges et la même
 * aimantation, sans empiéter sur la récitation voisine. Une plage qui ne touche aucun passage reste
 * telle quelle (rien à protéger).
 */
export function padRanges(
  ranges: readonly ExportRange[],
  intervals: readonly SuggestTiming[],
  duration: number,
  peaks: SuggestPeaks | null,
  options: SuggestOptions = {},
): ExportRange[] {
  const passages = suggestRanges(intervals, duration, peaks, {
    ...options,
    group: "verse",
  });
  const leadIn = clamp(options.leadIn ?? DEFAULT_LEAD_IN, 0, MAX_PADDING);
  const tailOut = clamp(options.tailOut ?? DEFAULT_TAIL_OUT, 0, MAX_PADDING);
  return ranges.map((range) => {
    // Début : si la plage commence dans (ou juste avant) un passage, on prend le début protégé de ce passage.
    const first = passages.find(
      (p) => range.start >= p.core_start - leadIn && range.start < p.core_end,
    );
    const last = [...passages]
      .reverse()
      .find(
        (p) => range.end > p.core_start && range.end <= p.core_end + tailOut,
      );
    return {
      start: first ? Math.min(range.start, first.start) : range.start,
      end: last ? Math.max(range.end, last.end) : range.end,
    };
  });
}

/** Résumé lisible pour un agent : quoi exporter et à quoi faire attention. */
export function suggestionNotes(ranges: readonly SuggestedRange[]): string[] {
  const notes: string[] = [];
  if (ranges.length === 0)
    notes.push(
      "Aucun passage coranique reconnu : rien à découper (les passages incertains ne sont jamais proposés).",
    );
  const withWarnings = ranges.filter((r) => r.warnings.length > 0).length;
  if (withWarnings > 0)
    notes.push(
      `${withWarnings} plage(s) portent des avertissements (voir warnings) : vérifier leur début et leur fin.`,
    );
  if (ranges.some((r) => r.status === "inferred"))
    notes.push(
      "Des passages sont « inferred » (déduits de la position, non entendus) : à signaler à l'utilisateur.",
    );
  return notes;
}
