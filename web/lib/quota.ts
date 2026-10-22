/**
 * Quota de stockage par utilisateur : `AQR_USER_QUOTA_BYTES` (entier d'octets, 0 ou absent =
 * illimité). Compte les fichiers envoyés (audio, vidéo) de toutes les sessions que l'utilisateur
 * possède, archivées et privées comprises. Lu à chaque import.
 */
export function userQuotaBytes(
  raw: string | undefined = process.env.AQR_USER_QUOTA_BYTES,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}
