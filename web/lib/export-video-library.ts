import { api } from "./api-client";

/** Une vidéo gardée sur le serveur (voir `lib/video-library.ts`). */
export type SavedVideo = {
  id: string;
  name: string;
  key: string;
  label: string;
  bytes: number;
  created_at: string;
};

/** Texte stable d'un objet : mêmes clés dans le même ordre, quel que soit l'ordre d'origine. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/**
 * Empreinte de ce qui fait une vidéo : le contenu affiché (passages et traductions), les réglages, la
 * plage et la cadence. Deux vidéos de même empreinte sont identiques : on réutilise celle du serveur.
 */
export async function videoKey(parts: unknown): Promise<string> {
  const data = new TextEncoder().encode(stableJson(parts));
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40);
}

export const savedVideoUrl = (
  sessionId: string,
  id: string,
  download = false,
) => `/api/sessions/${sessionId}/videos/${id}${download ? "?download=1" : ""}`;

export async function fetchSavedVideos(
  sessionId: string,
): Promise<{ videos: SavedVideo[]; total_bytes: number }> {
  return api(`/api/sessions/${sessionId}/videos`);
}

export async function deleteSavedVideo(
  sessionId: string,
  id: string,
): Promise<void> {
  await api(`/api/sessions/${sessionId}/videos/${id}`, { method: "DELETE" });
}

/** Les listes affichées se rechargent quand une vidéo est ajoutée ou supprimée. */
export const VIDEOS_CHANGED = "aqr:videos-changed";
export const announceVideosChanged = () =>
  window.dispatchEvent(new Event(VIDEOS_CHANGED));
