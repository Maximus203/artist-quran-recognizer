/**
 * Temps de la vidéo de fond : fonctions pures. La vidéo de fond n'a presque jamais la durée de la
 * récitation ; ce module dit QUEL INSTANT de la vidéo afficher à l'instant `t` de la récitation
 * (`vtime`), décrit la situation en français clair (`describeFit`) et donne les raccords à montrer
 * sur une chronologie (`loopSeams`).
 *
 * Temps LOCAL : `t` compte depuis le début de la vidéo exportée (0 = première image), et
 * `audioDuration` est la durée de CETTE vidéo exportée (une plage = une vidéo). Le départ (`offset`)
 * est UN SEUL pour toutes les plages ; il est borné pour chaque vidéo selon sa durée.
 *
 * La vidéo de fond est MUETTE : seul le son de la récitation est exporté (le mux ne lit que la copie
 * d'écoute, voir `export-video-args.ts`).
 */
import type { BackgroundVideoMode } from "./export-video-model";

export type FitInput = {
  /** Durée de la vidéo de fond (s) ; ≤ 0, absente ou infinie = inconnue. */
  videoDuration: number;
  /** Durée de la récitation exportée (s). */
  audioDuration: number;
  /** Départ dans la vidéo (s), utilisé seulement quand elle est plus longue. */
  offset: number;
  /** Comportement quand la vidéo est plus courte. */
  mode: BackgroundVideoMode;
};

export type FitSituation = "same" | "shorter" | "longer" | "unknown";

/** Écart (s) sous lequel on dit « même durée » : rien à régler. */
export const SAME_DURATION_TOLERANCE_S = 0.15;
/** Une « vidéo » plus courte que cela est une image fixe : on garde la première image. */
export const MIN_USABLE_VIDEO_S = 0.1;
/** Nombre maximal de raccords listés (vidéo minuscule sous une longue récitation). */
const MAX_SEAMS = 500;

const usable = (seconds: number): boolean =>
  Number.isFinite(seconds) && seconds > 0;

export function fitSituation(
  videoDuration: number,
  audioDuration: number,
): FitSituation {
  if (!usable(videoDuration) || videoDuration < MIN_USABLE_VIDEO_S)
    return "unknown";
  if (!usable(audioDuration)) return "unknown";
  if (Math.abs(videoDuration - audioDuration) <= SAME_DURATION_TOLERANCE_S)
    return "same";
  return videoDuration < audioDuration ? "shorter" : "longer";
}

/** Plus grand départ possible : la marge entre la vidéo et la récitation (0 si elle n'est pas plus longue). */
export function maxBackgroundOffset(
  videoDuration: number,
  audioDuration: number,
): number {
  if (!usable(videoDuration) || !usable(audioDuration)) return 0;
  return Math.max(0, videoDuration - audioDuration);
}

/** Un départ choisi, ramené dans les bornes de cette vidéo et de cette récitation. */
export function clampBackgroundOffset(
  offset: number,
  videoDuration: number,
  audioDuration: number,
): number {
  if (!Number.isFinite(offset)) return 0;
  return Math.min(
    Math.max(0, offset),
    maxBackgroundOffset(videoDuration, audioDuration),
  );
}

/**
 * L'instant de la vidéo de fond à afficher à l'instant `t` de la récitation. Toujours dans
 * `[0, videoDuration]` ; 0 quand la durée de la vidéo est inconnue (la première image reste).
 */
export function vtime(t: number, input: FitInput): number {
  const { videoDuration: D, audioDuration: L, mode } = input;
  const time = Number.isFinite(t) ? Math.max(0, t) : 0;
  if (!usable(D) || D < MIN_USABLE_VIDEO_S) return 0;
  // Durée de la récitation inconnue : la vidéo suit le temps, sans dépasser sa fin.
  if (!usable(L)) return Math.min(time, D);
  const situation = fitSituation(D, L);
  if (situation === "longer") {
    const start = clampBackgroundOffset(input.offset, D, L);
    return Math.min(start + time, D);
  }
  if (situation === "same") return Math.min(time, D);
  switch (mode) {
    case "pingpong": {
      const p = time % (2 * D);
      return p <= D ? p : 2 * D - p;
    }
    case "freeze":
      return Math.min(time, D);
    case "slow":
      return Math.min((time * D) / L, D);
    default:
      return time % D;
  }
}

/**
 * L'instant de la vidéo à montrer pour l'image rendue à l'instant `t` (secondes de la récitation entière)
 * d'une vidéo exportée qui couvre `[rangeStart, rangeStart + rangeLength]`.
 *  - la vidéo d'origine de la session (`clip: false`) suit le temps de la récitation, tel quel ;
 *  - une vidéo de fond choisie (`clip: true`) compte depuis le début de la vidéo exportée : le même
 *    départ vaut pour toutes les plages, borné selon la durée de chacune (`vtime`).
 */
export function backgroundVideoTimeAt(options: {
  clip: boolean;
  t: number;
  rangeStart: number;
  rangeLength: number;
  videoDuration: number;
  offset: number;
  mode: BackgroundVideoMode;
}): number {
  if (!options.clip) return options.t;
  return vtime(options.t - options.rangeStart, {
    videoDuration: options.videoDuration,
    audioDuration: options.rangeLength,
    offset: options.offset,
    mode: options.mode,
  });
}

/** Nombre à la française : virgule décimale, sans zéro inutile. */
function frNumber(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  return String(rounded).replace(".", ",");
}

/** Durée lisible : « 12 s », « 3,5 s », « 1 min 05 s ». */
export function formatSeconds(seconds: number): string {
  const total = Math.round(Math.max(0, seconds) * 10) / 10;
  if (total < 60) return `${frNumber(total, 1)} s`;
  const minutes = Math.floor(total / 60);
  const rest = Math.round((total - minutes * 60) * 10) / 10;
  const text = Number.isInteger(rest)
    ? String(rest).padStart(2, "0")
    : rest < 10
      ? `0${frNumber(rest, 1)}`
      : frNumber(rest, 1);
  return `${minutes} min ${text} s`;
}

/** « combien de fois » : 1,3 · 2,5 · 120 (à la décimale, au demi, à l'unité selon la taille). */
function roundRepeats(ratio: number): number {
  if (ratio < 2) return Math.round(ratio * 10) / 10;
  if (ratio < 10) return Math.round(ratio * 2) / 2;
  return Math.round(ratio);
}

export type FitDescription = {
  situation: FitSituation;
  /** Plus courte : combien de fois la récitation « contient » la vidéo (arrondi lisible) ; sinon null. */
  repeats: number | null;
  /** Plus longue : portion gardée, en secondes de la vidéo ; sinon null. */
  from: number | null;
  to: number | null;
  /** Phrase complète, en français clair. */
  text: string;
  /** Version courte, pour une pastille. */
  short: string;
};

/** La situation en clair : « plus courte : environ 2,5 fois », « plus longue : portion de X s à Y s »… */
export function describeFit(input: FitInput): FitDescription {
  const { videoDuration: D, audioDuration: L } = input;
  const situation = fitSituation(D, L);
  const none = { repeats: null, from: null, to: null };
  if (situation === "unknown") {
    const videoUnknown = !usable(D) || D < MIN_USABLE_VIDEO_S;
    return {
      situation,
      ...none,
      text: videoUnknown
        ? "Durée de la vidéo inconnue : sa première image reste affichée."
        : "Durée de la récitation inconnue : la vidéo suit le temps.",
      short: "Durée inconnue",
    };
  }
  if (situation === "same")
    return {
      situation,
      ...none,
      text: "La vidéo a la même durée que la récitation : rien à régler.",
      short: "Même durée",
    };
  if (situation === "longer") {
    const from = clampBackgroundOffset(input.offset, D, L);
    const to = from + L;
    return {
      situation,
      repeats: null,
      from,
      to,
      text: `Vidéo plus longue que la récitation : on garde la portion de ${formatSeconds(from)} à ${formatSeconds(to)}.`,
      short: `Plus longue · de ${formatSeconds(from)} à ${formatSeconds(to)}`,
    };
  }
  const repeats = roundRepeats(L / D);
  const times = `environ ${frNumber(repeats, 1)} fois`;
  const lead = "Vidéo plus courte que la récitation :";
  const sentence = {
    loop: `${lead} elle recommence toute seule, ${times}.`,
    pingpong: `${lead} elle va et vient (aller-retour), ${times} sa durée.`,
    freeze: `${lead} elle s'arrête sur sa dernière image après ${formatSeconds(D)}.`,
    slow: `${lead} elle est ralentie pour tout couvrir (à ${Math.round((D / L) * 100)} % de sa vitesse).`,
  }[input.mode];
  return {
    situation,
    repeats,
    from: null,
    to: null,
    text: sentence,
    short: `Plus courte · ${times}`,
  };
}

/**
 * Raccords à marquer sur la chronologie : les instants de la récitation où la vidéo recommence (boucle),
 * repart en arrière (aller-retour) ou s'arrête (figé). Vide pour le ralenti, la portion, la même durée
 * et la durée inconnue.
 */
export function loopSeams(input: FitInput): number[] {
  const { videoDuration: D, audioDuration: L, mode } = input;
  if (fitSituation(D, L) !== "shorter") return [];
  if (mode === "freeze") return [D];
  if (mode === "slow") return [];
  const seams: number[] = [];
  for (let k = 1; k <= MAX_SEAMS; k++) {
    const at = k * D;
    if (at >= L - 1e-9) break;
    seams.push(at);
  }
  return seams;
}
