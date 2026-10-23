import { AVATAR, avatarDimensionsMessage } from "./avatar-config";

/**
 * Mêmes bornes de dimensions que le serveur, appliquées dès que le navigateur a décodé l'image :
 * on ne propose pas « Utiliser cette photo » pour un fichier que le serveur refusera.
 */
export function checkPickedDimensions(
  width: number,
  height: number,
): string | null {
  const ok =
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    Math.min(width, height) >= AVATAR.minSide &&
    Math.max(width, height) <= AVATAR.maxSide &&
    width * height <= AVATAR.maxPixels;
  return ok ? null : avatarDimensionsMessage();
}

const ACCEPTED = new Set(AVATAR.accept.split(","));

/**
 * Contrôle de confort fait dans le navigateur AVANT l'envoi (évite d'envoyer 40 Mo pour un refus).
 * Il se fie au type annoncé par le navigateur, donc il ne protège de rien : le serveur relit le
 * contenu et décide seul. Un type vide (inconnu du système) passe : c'est le serveur qui jugera.
 */
export function checkPickedFile(file: {
  type: string;
  size: number;
}): string | null {
  if (file.size === 0) return "Ce fichier est vide : choisis une image.";
  if (file.size > AVATAR.maxBytes)
    return `Image trop lourde : ${AVATAR.maxBytes / (1024 * 1024)} Mo au maximum.`;
  if (file.type !== "" && !ACCEPTED.has(file.type))
    return "Format non pris en charge : choisis une image JPEG, PNG ou WebP.";
  return null;
}
