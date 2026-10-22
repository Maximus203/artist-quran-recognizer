/**
 * Estimation de la durée d'une analyse d'après l'historique — calcul pur, sans disque.
 *
 * Modèle retenu : `durée = chargement + coût × durée_audio`, ajusté par moteur. Un facteur
 * temps réel unique (RTF = durée de traitement / durée audio) est faux : les poids des modèles se
 * chargent à chaque analyse (≈ 50 s fixes), donc un audio de 18 s a un RTF de 3,4 et un audio de
 * 1 h un RTF de 0,03. Mesuré en validation croisée (leave-one-out) sur les 33 analyses
 * FastConformer réelles (voir `.artist/decision-log.md`) : l'erreur relative médiane passe de 38 %
 * (RTF médian) à 11 % (modèle affine).
 *
 * Aucun chiffre inventé : sans historique suffisant, l'estimation est refusée avec sa raison.
 */

/** Une analyse terminée du moteur concerné. */
export type HistoryPoint = {
  engine: string;
  audio_s: number;
  duration_s: number;
};

/** Mini d'analyses terminées d'un moteur pour annoncer une durée. */
export const MIN_SAMPLES = 3;
/** Deux audios plus proches que ça ne disent rien sur la pente (le bruit domine). */
const MIN_AUDIO_SPREAD_S = 5;

export type EstimateRefusal =
  | "no_history"
  | "insufficient_history"
  | "history_too_narrow"
  | "out_of_range";

/** Au-delà de 2× le plus long audio déjà traité, la droite n'est plus une mesure : refus. */
export const MAX_EXTRAPOLATION = 2;

export type Fit = {
  samples: number;
  /** Plus longue durée d'audio de l'historique (borne de validité de l'estimation). */
  audio_max_s: number;
  /** Secondes fixes par analyse (chargement des modèles). */
  overhead_s: number;
  /** Secondes de traitement par seconde d'audio. */
  seconds_per_audio_s: number;
  /** Erreur relative médiane en validation croisée (leave-one-out) ; null si < 4 points. */
  loo_median_rel_error: number | null;
  /** Rapport réel/estimé aux déciles 10 et 90 (validation croisée) ; null si < 4 points. */
  loo_ratio_low: number | null;
  loo_ratio_high: number | null;
};

export type Prediction = {
  /** Vrai si l'audio dépasse la plage mesurée : ne pas annoncer `total_s`. */
  out_of_range: boolean;
  total_s: number;
  low_s: number | null;
  high_s: number | null;
};

const usable = (p: HistoryPoint) =>
  Number.isFinite(p.audio_s) &&
  Number.isFinite(p.duration_s) &&
  p.audio_s > 0 &&
  p.duration_s > 0;

export function median(values: number[]): number {
  return quantile(values, 0.5);
}

/** Quantile à interpolation linéaire (`q` dans [0, 1]) ; NaN pour une liste vide. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const low = Math.floor(position);
  const high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

function weightedMedian(values: number[], weights: number[]): number {
  const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
  const half = weights.reduce((sum, w) => sum + w, 0) / 2;
  let cumulative = 0;
  for (const i of order) {
    cumulative += weights[i];
    if (cumulative >= half) return values[i];
  }
  return values[order[order.length - 1]];
}

export type RtfStats = {
  median: number;
  p90: number;
  mean: number;
  min: number;
  max: number;
};

/** Facteur temps réel (durée de traitement / durée audio) : à présenter avec sa dispersion. */
export function rtfStats(points: HistoryPoint[]): RtfStats | null {
  const rtfs = points.filter(usable).map((p) => p.duration_s / p.audio_s);
  if (rtfs.length === 0) return null;
  return {
    median: median(rtfs),
    p90: quantile(rtfs, 0.9),
    mean: rtfs.reduce((sum, v) => sum + v, 0) / rtfs.length,
    min: Math.min(...rtfs),
    max: Math.max(...rtfs),
  };
}

type Line = { overhead_s: number; seconds_per_audio_s: number };

/**
 * Droite robuste (Theil–Sen pondérée) : la pente est la médiane des pentes entre paires de points,
 * pondérées par l'écart d'audio (une paire d'audios presque identiques ne pèse presque rien).
 * Quelques analyses lancées en parallèle (donc lentes) ne déplacent pas l'estimation.
 */
function robustLine(points: HistoryPoint[]): Line | "narrow" {
  const slopes: number[] = [];
  const weights: number[] = [];
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].audio_s - points[i].audio_s;
      if (Math.abs(dx) < MIN_AUDIO_SPREAD_S) continue;
      slopes.push((points[j].duration_s - points[i].duration_s) / dx);
      weights.push(Math.abs(dx));
    }
  if (slopes.length === 0) return "narrow";
  const slope = Math.max(0, weightedMedian(slopes, weights));
  const overhead = Math.max(
    0,
    median(points.map((p) => p.duration_s - slope * p.audio_s)),
  );
  return { overhead_s: overhead, seconds_per_audio_s: slope };
}

const linePredict = (line: Line, audio_s: number) =>
  line.overhead_s + line.seconds_per_audio_s * audio_s;

/** Pour chaque point : on l'écarte, on ajuste sur les autres, on mesure l'erreur relative. */
export function looRelativeErrors(points: HistoryPoint[]): number[] {
  return looPairs(points.filter(usable)).map(
    ({ actual, predicted }) => Math.abs(predicted - actual) / actual,
  );
}
function looPairs(
  points: HistoryPoint[],
): Array<{ actual: number; predicted: number }> {
  const out: Array<{ actual: number; predicted: number }> = [];
  for (let i = 0; i < points.length; i++) {
    const rest = points.filter((_, j) => j !== i);
    if (rest.length < MIN_SAMPLES) continue;
    const line = robustLine(rest);
    if (line === "narrow") continue;
    out.push({
      actual: points[i].duration_s,
      predicted: linePredict(line, points[i].audio_s),
    });
  }
  return out;
}

export function fitEngine(
  all: HistoryPoint[],
): { ok: true; fit: Fit } | { ok: false; reason: EstimateRefusal } {
  const points = all.filter(usable);
  if (points.length === 0) return { ok: false, reason: "no_history" };
  if (points.length < MIN_SAMPLES)
    return { ok: false, reason: "insufficient_history" };
  const line = robustLine(points);
  if (line === "narrow") return { ok: false, reason: "history_too_narrow" };
  const pairs = looPairs(points);
  const ratios = pairs
    .filter((p) => p.predicted > 0)
    .map((p) => p.actual / p.predicted);
  const errors = pairs.map((p) => Math.abs(p.predicted - p.actual) / p.actual);
  const enough = points.length > MIN_SAMPLES && ratios.length > 0;
  return {
    ok: true,
    fit: {
      samples: points.length,
      audio_max_s: Math.max(...points.map((p) => p.audio_s)),
      ...line,
      loo_median_rel_error: enough ? median(errors) : null,
      loo_ratio_low: enough ? Math.min(1, quantile(ratios, 0.1)) : null,
      loo_ratio_high: enough ? Math.max(1, quantile(ratios, 0.9)) : null,
    },
  };
}

export function predictTotal(fit: Fit, audio_s: number): Prediction {
  const total = linePredict(fit, Math.max(0, audio_s));
  return {
    out_of_range: audio_s > fit.audio_max_s * MAX_EXTRAPOLATION,
    total_s: total,
    low_s: fit.loo_ratio_low === null ? null : total * fit.loo_ratio_low,
    high_s: fit.loo_ratio_high === null ? null : total * fit.loo_ratio_high,
  };
}

export type RunningJob = { id: string; remaining_s: number | null };
export type WaitingJob = { id: string; total_s: number | null };

/**
 * Fin prévue (secondes à partir de maintenant) de chaque analyse en cours ou en attente, en
 * supposant l'ordre FIFO. Une durée inconnue rend inconnues toutes celles qui en dépendent.
 */
export function projectQueue(
  running: RunningJob[],
  waiting: WaitingJob[],
  concurrency: number,
): Map<string, number | null> {
  const eta = new Map<string, number | null>();
  const slots: Array<number | null> = running.map((r) => {
    eta.set(r.id, r.remaining_s);
    return r.remaining_s;
  });
  while (slots.length < Math.max(1, concurrency)) slots.push(0);
  for (const job of waiting) {
    const known = slots.filter((s): s is number => s !== null);
    const hasUnknown = slots.length !== known.length;
    const earliest = known.length > 0 ? Math.min(...known) : null;
    // Une place inconnue pourrait se libérer avant la plus proche place connue.
    const startable = earliest !== null && (!hasUnknown || earliest === 0);
    const index = startable ? slots.indexOf(earliest) : slots.indexOf(null);
    const finish =
      startable && job.total_s !== null
        ? (earliest as number) + job.total_s
        : null;
    eta.set(job.id, finish);
    slots[index] = finish;
  }
  return eta;
}
