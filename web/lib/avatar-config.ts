/**
 * Photo de profil : TOUTES les limites et réglages au même endroit (client et serveur). Aucun
 * seuil n'est écrit ailleurs : l'interface et les routes lisent ce fichier.
 */
export const AVATAR = {
  /** Taille maximale du fichier envoyé (octets) : 2 Mo. */
  maxBytes: 2 * 1024 * 1024,
  /** Côté du carré servi (pixels) : l'avatar le plus grand de l'interface fait 56 px (×4 pour les écrans denses). */
  size: 256,
  /** Plus petit côté accepté : en dessous, l'agrandissement serait flou. */
  minSide: 32,
  /** Plus grand côté accepté, et nombre maximal de pixels : garde contre les « bombes » de décompression. */
  maxSide: 8192,
  maxPixels: 40_000_000,
  /** Fond sous les transparences (le JPEG n'en porte pas). */
  flattenColor: "white",
  /** Qualité JPEG de ffmpeg (2 = très bonne, 31 = pire). */
  jpegQuality: 3,
  /** Plafond de la sortie réencodée, et durée maximale du réencodage. */
  maxOutputBytes: 512 * 1024,
  encodeTimeoutMs: 20_000,
  /** Format servi : toujours le même, quel que soit celui d'origine. */
  mime: "image/jpeg",
  extension: "jpg",
  /** Formats acceptés à l'envoi (pour l'attribut `accept` du sélecteur de fichier). */
  accept: "image/jpeg,image/png,image/webp",
  /** Longueur de l'empreinte (hexadécimal) : version de l'image pour le cache. */
  hashLength: 16,
} as const;

/** Message de refus des dimensions : le même dans le navigateur (avant l'envoi) et sur le serveur. */
export const avatarDimensionsMessage = (): string =>
  `Dimensions refusées : de ${AVATAR.minSide} à ${AVATAR.maxSide} px de côté.`;

/** Adresse de la photo d'un compte ; `version` (empreinte) rend l'adresse neuve à chaque changement. */
export function avatarUrl(userId: number, version: string): string {
  return `/api/users/${userId}/avatar?v=${encodeURIComponent(version)}`;
}

/** Ce que l'API dit de l'auteur d'une session ou d'un compte : jamais d'e-mail, jamais de donnée sensible. */
export type PersonRef = {
  id: number;
  username: string;
  /** Empreinte de la photo, ou null = avatar par défaut (initiale). */
  avatar_version: string | null;
};
