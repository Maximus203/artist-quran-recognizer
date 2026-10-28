/**
 * Mode d'écoute de l'écran « En direct » : récitation guidée (la sourate est annoncée, le moteur ne
 * cherche que dans celle-ci et enchaîne les versets suivants) ou écoute classique (tout le Coran).
 * Mémorisé dans le navigateur, comme le mode technique. Fonctions pures, sans React.
 */
import { SURAH_NAMES } from "./surahs";

export type LiveMode =
  | { kind: "classic" }
  | { kind: "guided"; surah: number | null };

export const LIVE_MODE_STORAGE_KEY = "aqr.ui.live.mode.v1";
export const DEFAULT_LIVE_MODE: LiveMode = { kind: "classic" };

const isSurah = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  value >= 1 &&
  value <= SURAH_NAMES.length;

/** Mode mémorisé, sinon l'écoute classique ; tout contenu illisible est ignoré. */
export function parseLiveMode(raw: string | null): LiveMode {
  if (!raw) return DEFAULT_LIVE_MODE;
  try {
    const value = JSON.parse(raw) as { kind?: unknown; surah?: unknown };
    if (value.kind === "guided")
      return {
        kind: "guided",
        surah: isSurah(value.surah) ? value.surah : null,
      };
    return DEFAULT_LIVE_MODE;
  } catch {
    return DEFAULT_LIVE_MODE;
  }
}

export function readLiveMode(): LiveMode {
  try {
    return parseLiveMode(window.localStorage.getItem(LIVE_MODE_STORAGE_KEY));
  } catch {
    return DEFAULT_LIVE_MODE;
  }
}

export function writeLiveMode(mode: LiveMode): void {
  try {
    window.localStorage.setItem(LIVE_MODE_STORAGE_KEY, JSON.stringify(mode));
  } catch {
    // stockage indisponible : le choix vaut pour cette page seulement
  }
}

/** Sourate à annoncer au service (`options.surah`), ou null en écoute classique. */
export function modeSurah(mode: LiveMode): number | null {
  return mode.kind === "guided" ? mode.surah : null;
}

/** Une récitation guidée ne démarre qu'avec une sourate choisie. */
export function canStartWith(mode: LiveMode): boolean {
  return mode.kind === "classic" || mode.surah !== null;
}

/** « Récitation guidée · Al-Baqara » / « Écoute classique ». */
export function modeLabel(mode: LiveMode): string {
  if (mode.kind === "classic") return "Écoute classique";
  return mode.surah === null
    ? "Récitation guidée"
    : `Récitation guidée · ${SURAH_NAMES[mode.surah - 1]}`;
}
