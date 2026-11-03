/**
 * Décalage audio : l'oreille n'entend pas le son à l'instant où `audio.currentTime` le publie. Un
 * appareil d'écoute (écouteurs Bluetooth surtout : 100 à 300 ms) retarde la sortie, alors que le
 * navigateur ne le sait pas. Le surlignage, lui, suit la position publiée : il paraît en avance sur
 * la voix. Le décalage, réglé à l'oreille par le testeur, retarde le surlignage (mot affiché = mot à
 * l'instant `t − décalage`). Fonctions pures, sans React ni DOM ; la valeur est une préférence du
 * compte (`audioOffsetMs`, schéma dans `preferences-schema.ts`).
 *
 * Seul l'AFFICHAGE est décalé : le lecteur, la tête de lecture de l'onde, les temps du moteur et les
 * exports ne changent jamais.
 */
export const AUDIO_OFFSET = {
  /** Millisecondes. Positif = le son arrive plus tard que la position publiée. */
  min: -500,
  max: 500,
  step: 10,
  fallback: 0,
  /** Durée maximale (s) du passage lu en boucle pour caler à l'oreille. */
  calibrationSpanS: 8,
} as const;

/** Plage lue en boucle pour caler : le début du passage, au plus `calibrationSpanS` ; `null` si vide. */
export function calibrationWindow(
  range: readonly [number, number] | null,
): [number, number] | null {
  if (!range || !Number.isFinite(range[0]) || !Number.isFinite(range[1]))
    return null;
  if (range[1] <= range[0]) return null;
  return [
    range[0],
    Math.min(range[1], range[0] + AUDIO_OFFSET.calibrationSpanS),
  ];
}

/** Valeur entière, bornée et calée sur le pas ; une valeur invalide donne le défaut. */
export function clampAudioOffset(ms: number): number {
  if (!Number.isFinite(ms)) return AUDIO_OFFSET.fallback;
  const snapped = Math.round(ms / AUDIO_OFFSET.step) * AUDIO_OFFSET.step;
  const bounded = Math.min(
    AUDIO_OFFSET.max,
    Math.max(AUDIO_OFFSET.min, snapped),
  );
  return bounded === 0 ? 0 : bounded; // jamais -0
}

export const stepAudioOffset = (current: number, direction: -1 | 1): number =>
  clampAudioOffset(current + direction * AUDIO_OFFSET.step);

/** Instant (s) dont l'oreille entend le son quand le lecteur est à `time` : `time − décalage`. */
export function heardTime(time: number, offsetMs: number): number {
  if (!Number.isFinite(offsetMs) || offsetMs === 0) return time;
  return Math.max(0, time - offsetMs / 1000);
}

/** « +150 ms », « −40 ms » (vrai signe moins), « 0 ms ». */
export function formatAudioOffset(ms: number): string {
  if (ms === 0) return "0 ms";
  return `${ms > 0 ? "+" : "−"}${Math.abs(ms)} ms`;
}
