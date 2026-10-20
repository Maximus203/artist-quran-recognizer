/**
 * Géométrie de la timeline : un seul repère (0 % = 0 s, 100 % = fin de l'audio) partagé par
 * la tête de lecture, les segments et les graduations. Fonctions pures, testées.
 */

/** Fenêtres de zoom : ce que l'écran montre d'un coup (`null` = fichier entier). */
export const ZOOM_SPANS: ReadonlyArray<{
  seconds: number | null;
  label: string;
}> = [
  { seconds: null, label: "Fichier entier" },
  { seconds: 600, label: "10 min" },
  { seconds: 120, label: "2 min" },
  { seconds: 30, label: "30 s" },
  { seconds: 10, label: "10 s" },
];

/** Pas « ronds » des graduations, en secondes. */
const NICE_STEPS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200,
];
/** Au plus ce nombre d'intervalles entre graduations sur la fenêtre visible. */
const MAX_TICKS = 12;
/** Place minimale d'un libellé de graduation (« 1:02:05 » lisible). */
const MIN_LABEL_PX = 64;

/** Position d'un instant en % de la durée, bornée à [0, 100]. */
export function percentAt(seconds: number, duration: number): number {
  if (!(duration > 0) || !Number.isFinite(seconds)) return 0;
  return Math.min(100, Math.max(0, (seconds / duration) * 100));
}

/** Durée réellement visible : la fenêtre choisie, sans dépasser le fichier. */
export function visibleSpan(duration: number, span: number | null): number {
  return span === null ? duration : Math.min(span, duration);
}

/** Largeur des pistes en % de la zone visible (100 % = tout le fichier tient). */
export function laneWidthPercent(
  duration: number,
  span: number | null,
): number {
  if (span === null || !(duration > 0)) return 100;
  return Math.max(100, (duration / span) * 100);
}

/** `scrollLeft` qui centre `seconds`, borné au contenu défilable. */
export function centeredScroll(
  seconds: number,
  duration: number,
  viewportPx: number,
  contentPx: number,
): number {
  if (!(duration > 0)) return 0;
  const x = (seconds / duration) * contentPx - viewportPx / 2;
  return Math.round(
    Math.min(Math.max(0, contentPx - viewportPx), Math.max(0, x)),
  );
}

/**
 * Plus petit pas rond qui laisse au plus `MAX_TICKS` intervalles dans la fenêtre, et au moins
 * `MIN_LABEL_PX` pixels par libellé quand la largeur affichée est connue.
 */
export function tickStep(spanSeconds: number, widthPx = Infinity): number {
  const most = Math.min(
    MAX_TICKS,
    Math.max(2, Math.floor(widthPx / MIN_LABEL_PX)),
  );
  return (
    NICE_STEPS.find((step) => spanSeconds / step <= most) ??
    NICE_STEPS[NICE_STEPS.length - 1]
  );
}

/** Graduations de 0 à `duration` inclus (multiples entiers du pas : pas de dérive). */
export function ticks(duration: number, step: number): number[] {
  if (!(duration > 0) || !(step > 0)) return [];
  const count = Math.floor(duration / step + 1e-9);
  return Array.from({ length: count + 1 }, (_, i) =>
    Number((i * step).toFixed(3)),
  );
}

/** `mm:ss`, `h:mm:ss` au-delà d'une heure, dixièmes si le pas est sous la seconde. */
export function formatTick(seconds: number, step: number): string {
  const tenths = step < 1;
  const total = tenths ? Math.round(seconds * 10) / 10 : Math.round(seconds);
  const h = Math.floor(total / 3600),
    m = Math.floor(total / 60) % 60,
    s = total % 60;
  const sec = tenths
    ? s.toFixed(1).padStart(4, "0")
    : String(Math.floor(s)).padStart(2, "0");
  return `${h ? `${h}:` : ""}${String(m).padStart(2, "0")}:${sec}`;
}
