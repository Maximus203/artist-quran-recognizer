/**
 * Quota de stockage par utilisateur : `AQR_USER_QUOTA_BYTES` (entier d'octets), **2 Gio par défaut**
 * (décision du mainteneur : le serveur Alpha héberge d'autres applications critiques) ; `0` = illimité,
 * une valeur invalide retombe sur le défaut. Compte l'audio envoyé ET les vidéos exportées gardées sur
 * le serveur, pour toutes les sessions que l'utilisateur possède, archivées et privées comprises. Lu à
 * chaque import. Retourne 0 pour « illimité ».
 */
export const DEFAULT_USER_QUOTA_BYTES = 2 * 1024 ** 3;

export function userQuotaBytes(
  raw: string | undefined = process.env.AQR_USER_QUOTA_BYTES,
): number {
  if (raw === undefined || raw.trim() === "") return DEFAULT_USER_QUOTA_BYTES;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return DEFAULT_USER_QUOTA_BYTES;
  return value;
}

/** Un ajout de `add` octets tient-il dans le quota `limit` (0 = illimité) quand `used` est déjà pris ? */
export function fitsQuota(used: number, add: number, limit: number): boolean {
  return limit === 0 || used + add <= limit;
}
