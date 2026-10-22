/**
 * Quota de stockage par utilisateur : `AQR_USER_QUOTA_BYTES` (entier d'octets), **5 Gio par défaut**
 * (décision du mainteneur) ; `0` = illimité, une valeur invalide retombe sur le défaut. Compte les
 * fichiers envoyés (audio, vidéo) de toutes les sessions que l'utilisateur possède, archivées et
 * privées comprises. Lu à chaque import. Retourne 0 pour « illimité ».
 */
export const DEFAULT_USER_QUOTA_BYTES = 5 * 1024 ** 3;

export function userQuotaBytes(
  raw: string | undefined = process.env.AQR_USER_QUOTA_BYTES,
): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_USER_QUOTA_BYTES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return DEFAULT_USER_QUOTA_BYTES;
  return value;
}
