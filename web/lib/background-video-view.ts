/**
 * Modèle de vue de la vidéo de fond : fonctions PURES qui disent quoi dessiner (bande « film » à répétitions et
 * raccords, fenêtre éclairée de la portion) et quoi écrire. Tous les temps viennent de `export-video-vtime.ts`
 * (`fitSituation`, `loopSeams`, `clampBackgroundOffset`, `describeFit`) : aucune règle n'est recalculée ici, la
 * même source dit la même chose à l'aperçu, au rendu et à l'écran.
 */
import type { BackgroundVideoMode } from "./export-video-model";
import {
  clampBackgroundOffset,
  describeFit,
  fitSituation,
  loopSeams,
  maxBackgroundOffset,
  type FitInput,
} from "./export-video-vtime";
import { formatDurationFr } from "./format";

/** Au-delà, les tuiles sont un motif répété (une vidéo de 0,5 s sous une récitation d'une heure). */
const MAX_TILES = 60;
/** Fenêtre plus étroite que cela : ses repères se rangent à côté. */
const NARROW_PCT = 16;
const TENTH = 0.1;

export type FilmTile = { left: number; width: number; flipped: boolean };

export type FilmView = {
  /** « shorter » : le comportement choisi ; sinon la situation. */
  kind: "same" | "unknown" | "portion" | BackgroundVideoMode;
  /** Tuiles de vidéo sur la barre de la récitation (pourcentages de sa durée). */
  tiles: FilmTile[];
  /** Zone figée après la dernière image (« s'arrêter sur la dernière image »). */
  frozen: { left: number; width: number } | null;
  /** Raccords : instants où la vidéo recommence, repart en arrière ou s'arrête (% de la récitation). */
  seams: number[];
  seamTimes: number[];
  /** Trop de répétitions pour des tuiles : le composant répète un motif de `tileWidth` %. */
  dense: boolean;
  tileWidth: number;
};

const WHOLE: FilmTile[] = [{ left: 0, width: 100, flipped: false }];
const empty = (kind: FilmView["kind"], tiles: FilmTile[]): FilmView => ({
  kind,
  tiles,
  frozen: null,
  seams: [],
  seamTimes: [],
  dense: false,
  tileWidth: 100,
});

export function filmView(input: FitInput): FilmView {
  const { videoDuration: D, audioDuration: L, mode } = input;
  const situation = fitSituation(D, L);
  if (situation === "longer") return empty("portion", []);
  if (situation !== "shorter")
    return empty(situation === "same" ? "same" : "unknown", WHOLE);

  const tileWidth = (D / L) * 100;
  const times = loopSeams(input).slice(0, MAX_TILES);
  const seams = times.map((t) => (t / L) * 100);
  const view = (over: Partial<FilmView>): FilmView => ({
    ...empty(mode, WHOLE),
    seams,
    seamTimes: times,
    tileWidth,
    ...over,
  });
  if (mode === "slow") return view({ seams: [], seamTimes: [] });
  if (mode === "freeze")
    return view({
      tiles: [{ left: 0, width: tileWidth, flipped: false }],
      frozen: { left: tileWidth, width: 100 - tileWidth },
    });
  const count = Math.ceil(L / D - 1e-9);
  if (count > MAX_TILES) return view({ tiles: [], dense: true });
  return view({
    tiles: Array.from({ length: count }, (_, k) => ({
      left: k * tileWidth,
      width: Math.min(tileWidth, 100 - k * tileWidth),
      flipped: mode === "pingpong" && k % 2 === 1,
    })),
  });
}

/** Les raccords dits à un lecteur d'écran : les premiers instants, puis « et ainsi de suite ». */
export function seamsText(seamTimes: readonly number[]): string {
  if (seamTimes.length === 0) return "";
  const SHOWN = 6;
  const listed = seamTimes.slice(0, SHOWN).map((t) => formatDurationFr(t));
  const more = seamTimes.length > SHOWN ? ", et ainsi de suite" : "";
  return `La vidéo recommence à ${listed.join(", ")}${more}.`;
}

/** `m:ss,d` : « 1:05,3 ». Une valeur invalide ou négative vaut 0. */
export function formatClockTenths(seconds: number): string {
  const tenths = Math.round(
    Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10,
  );
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")},${tenths % 10}`;
}

// ── portion (vidéo plus longue que la récitation) ───────────────────────────────────────────────

type Span = Pick<FitInput, "videoDuration" | "audioDuration">;

export type PortionView = {
  /** Plus grand départ possible (s). */
  max: number;
  from: number;
  to: number;
  /** Fenêtre éclairée, en % de la vidéo. */
  leftPct: number;
  widthPct: number;
  narrow: boolean;
  /** Pour `aria-valuetext`. */
  valueText: string;
};

const tenth = (value: number) => Math.round(value * 10) / 10;

export function portionView(input: FitInput): PortionView {
  const { videoDuration: D, audioDuration: L } = input;
  const max = maxBackgroundOffset(D, L);
  const from = clampBackgroundOffset(input.offset, D, L);
  const to = D > 0 ? Math.min(D, from + L) : from;
  const widthPct = D > 0 ? Math.min(100, (L / D) * 100) : 100;
  return {
    max,
    from,
    to,
    leftPct: D > 0 ? (from / D) * 100 : 0,
    widthPct,
    narrow: widthPct < NARROW_PCT,
    valueText: `Commence à ${formatClockTenths(from)} · finit à ${formatClockTenths(to)}`,
  };
}

/** Un départ, ramené dans les bornes et arrondi au dixième (jamais 0,30000000000000004). */
function settle(offset: number, span: Span): number {
  const max = maxBackgroundOffset(span.videoDuration, span.audioDuration);
  return Math.min(max, Math.max(0, tenth(offset)));
}

/** Boutons ± 0,1 s et ± 1 s. */
export function nudgeOffset(offset: number, delta: number, span: Span): number {
  return settle(offset + delta, span);
}

/** « Début · milieu · fin ». Le milieu est arrondi vers le bas au dixième. */
export function presetOffset(
  preset: "start" | "middle" | "end",
  span: Span,
): number {
  const max = maxBackgroundOffset(span.videoDuration, span.audioDuration);
  if (preset === "start") return 0;
  if (preset === "end") return max;
  return settle(Math.floor((max / 2) * 10 + 1e-9) / 10, span);
}

/**
 * Clavier sur la fenêtre : flèches 0,1 s (Maj : 1 s), Page haut / bas 5 s, Début, Fin. `null` pour toute autre
 * touche (elle garde son sens habituel).
 */
export function keyboardOffset(
  key: string,
  shift: boolean,
  offset: number,
  span: Span,
): number | null {
  const small = shift ? 1 : TENTH;
  const delta: Record<string, number> = {
    ArrowRight: small,
    ArrowUp: small,
    ArrowLeft: -small,
    ArrowDown: -small,
    PageUp: -5,
    PageDown: 5,
  };
  if (key === "Home") return 0;
  if (key === "End")
    return maxBackgroundOffset(span.videoDuration, span.audioDuration);
  return key in delta ? nudgeOffset(offset, delta[key], span) : null;
}

/** Glisser le film : un déplacement en pixels sur une piste de `trackPx` pixels devient des secondes. */
export function offsetFromDrag(
  startOffset: number,
  deltaPx: number,
  trackPx: number,
  span: Span,
): number {
  if (!(trackPx > 0)) return startOffset;
  return settle(startOffset + (deltaPx / trackPx) * span.videoDuration, span);
}

/** Toucher la piste : la fenêtre se centre sur le point touché. */
export function offsetFromTap(
  xPx: number,
  trackPx: number,
  span: Span,
): number {
  if (!(trackPx > 0)) return 0;
  return settle(
    (xPx / trackPx) * span.videoDuration - span.audioDuration / 2,
    span,
  );
}

// ── les phrases ─────────────────────────────────────────────────────────────────────────────────

/** La situation en une phrase claire ; avec plusieurs parties, dit qu'un seul départ vaut pour toutes. */
export function statusText(input: FitInput, parts = 1): string {
  const fitText = describeFit(input);
  const shared =
    fitText.situation === "longer" && parts > 1
      ? ` Le même départ vaut pour les ${parts} parties exportées (il est borné pour chacune selon sa durée).`
      : "";
  return `${fitText.text}${shared}`;
}

export const MODE_CHOICES: ReadonlyArray<{
  mode: BackgroundVideoMode;
  title: string;
  hint: string;
}> = [
  {
    mode: "loop",
    title: "Recommencer",
    hint: "Elle repart du début, en continu. C’est le réglage conseillé.",
  },
  {
    mode: "pingpong",
    title: "Aller-retour",
    hint: "Elle se lit à l’endroit, puis à l’envers : pas de saut visible.",
  },
  {
    mode: "freeze",
    title: "S’arrêter sur la dernière image",
    hint: "Pas de boucle : l’image reste figée jusqu’à la fin de la récitation.",
  },
  {
    mode: "slow",
    title: "Ralentir pour tout couvrir",
    hint: "Elle est étirée pour durer autant que la récitation.",
  },
];
