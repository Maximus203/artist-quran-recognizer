import { statfs } from "node:fs/promises";

/**
 * Place disque : avant d'accepter un envoi, on vérifie qu'il reste de quoi l'écrire ET une réserve
 * (`AQR_MIN_FREE_BYTES`, 1 Gio par défaut) pour que le serveur ne sature jamais son disque (journaux,
 * base, sessions en cours). Un envoi refusé ici ne laisse rien sur le disque.
 */
const GIB = 1024 ** 3;
export function minFreeBytes(
  raw: string | undefined = process.env.AQR_MIN_FREE_BYTES,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : GIB;
}

/** Octets libres pour un utilisateur ordinaire sur le volume de `dir`, ou `null` si inconnu. */
export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const info = await statfs(dir);
    return Number(info.bavail) * Number(info.bsize);
  } catch {
    return null;
  }
}

export const DISK_FULL_MESSAGE =
  "L'espace disque du serveur est presque plein : l'envoi est refusé pour ne pas le saturer. Réessaie plus tard ou préviens l'administrateur.";

/** Vrai si écrire `incoming` octets laisserait moins que la réserve. `free = null` : inconnu, on laisse passer. */
export function wouldFillDisk(
  free: number | null,
  incoming: number,
  reserve = minFreeBytes(),
): boolean {
  if (free === null) return false;
  return free - (Number.isFinite(incoming) ? incoming : 0) < reserve;
}
