/**
 * Parole libre dans la vidéo d'export (ADR-0027) : désactivée par défaut. Le mode « validée »
 * n'affiche que les passages qu'un humain a relus et approuvés ; « toutes » ajoute ceux qui restent
 * à relire (jamais un passage rejeté ni un passage retenu par les garde-fous).
 */
import {
  freeSpeechByIndex,
  shownFreeSpeech,
  type FreeSpeech,
  type TranslatedItem,
} from "./free-speech";

export const FREE_SPEECH_MODES = ["off", "approved", "all"] as const;
export type FreeSpeechMode = (typeof FREE_SPEECH_MODES)[number];

export const DEFAULT_FREE_SPEECH_MODE: FreeSpeechMode = "off";

export const FREE_SPEECH_MODE_LABELS: Record<FreeSpeechMode, string> = {
  off: "Ne pas inclure",
  approved: "Inclure les passages validés",
  all: "Inclure aussi ceux à relire",
};

/** Les passages que la vidéo montrera, ou null (mode « off » ou aucun fichier). */
export function freeSpeechForVideo(
  doc: FreeSpeech | null | undefined,
  mode: FreeSpeechMode,
): ReadonlyMap<number, TranslatedItem> | null {
  if (mode === "off" || !doc) return null;
  return shownFreeSpeech(freeSpeechByIndex(doc), mode === "all");
}
