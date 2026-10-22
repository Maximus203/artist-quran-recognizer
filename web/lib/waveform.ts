/**
 * Forme d'onde : les crêtes viennent du serveur (`aqr.listening-peaks/1`, 50 par seconde, 0 à 1).
 * On ne dessine que la fenêtre visible, une barre par tranche de temps, en gardant le MAXIMUM de la
 * tranche (un pic fin ne disparaît jamais, même sur 45 minutes d'audio en une seule vue).
 */

/** Plus grand pic du fichier (jamais zéro : un silence ne divise pas par zéro). */
export function peakNorm(peaks: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < peaks.length; i++) if (peaks[i] > max) max = peaks[i];
  return max > 0 ? max : 1e-6;
}

/** Hauteurs (0 à 1) de `bars` barres couvrant [t0, t1] ; 0 hors du fichier. */
export function barHeights(
  peaks: ArrayLike<number>,
  duration: number,
  t0: number,
  t1: number,
  bars: number,
  norm: number,
): number[] {
  const count = Math.max(0, Math.floor(bars));
  const heights = new Array<number>(count).fill(0);
  if (count === 0 || !(duration > 0) || !(t1 > t0) || peaks.length === 0)
    return heights;
  const perSecond = peaks.length / duration;
  const width = (t1 - t0) / count;
  for (let i = 0; i < count; i++) {
    const from = Math.floor((t0 + i * width) * perSecond);
    const to = Math.ceil((t0 + (i + 1) * width) * perSecond);
    if (to <= 0 || from >= peaks.length) continue;
    let max = 0;
    for (let j = Math.max(0, from); j < Math.min(peaks.length, Math.max(to, from + 1)); j++)
      if (peaks[j] > max) max = peaks[j];
    heights[i] = Math.min(1, max / norm);
  }
  return heights;
}
