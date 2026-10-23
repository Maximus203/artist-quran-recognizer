/**
 * Horloge d'affichage : le lecteur publie la position à chaque image de l'écran (jusqu'à 240 fois par
 * seconde sur un écran rapide). La tête de lecture suit cette cadence en direct, hors de React ; mais un
 * chiffre qui change 240 fois par seconde est illisible et force une mise en page à chaque image. Les
 * textes (position, longueur provisoire) lisent donc cette horloge : exacte à l'arrêt, au plus
 * `CLOCK_HZ` changements par seconde en lecture.
 */
export const CLOCK_HZ = 20;

/**
 * Écart minimal (ms) entre deux publications de la position pendant la lecture : ~60 images par
 * seconde au plus, même sur un écran à 144 ou 240 Hz où la tête de lecture ne gagne rien à être
 * redessinée à chaque image (chaque publication déclenche mise en page, peinture et composition).
 */
export const PUBLISH_MIN_MS = 15;

/** Vrai quand il est temps de publier la position : jamais publiée, ou assez de temps écoulé. */
export function dueForPublish(
  lastAt: number | null,
  now: number,
  minMs: number = PUBLISH_MIN_MS,
): boolean {
  return lastAt === null || now < lastAt || now - lastAt >= minMs;
}

export function clockTime(
  state: { time: number; playing: boolean },
  hz: number = CLOCK_HZ,
): number {
  if (!state.playing || !(hz > 0)) return state.time;
  return Math.floor(state.time * hz) / hz;
}
