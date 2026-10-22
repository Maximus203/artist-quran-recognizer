import { formatBytesFr } from "./format";

/**
 * Jauge de stockage et contrôle d'import AVANT l'envoi. Le serveur reste juge (`413` au-delà du
 * quota) ; ici on évite d'envoyer un fichier voué au refus et on prévient à 80 %. Pur.
 */
export const WARN_AT = 0.8;

export type Quota = { used_bytes: number; limit_bytes: number | null };
export type StorageState = {
  state: "ok" | "warn" | "full";
  /** 0 à 100 ; 0 sans quota. */
  percent: number;
  /** Octets encore libres ; null sans quota. */
  remaining: number | null;
};

export function storageState(quota: Quota): StorageState {
  if (!quota.limit_bytes || quota.limit_bytes <= 0)
    return { state: "ok", percent: 0, remaining: null };
  const ratio = quota.used_bytes / quota.limit_bytes;
  return {
    state: ratio >= 1 ? "full" : ratio >= WARN_AT ? "warn" : "ok",
    percent: Math.min(100, Math.round(ratio * 100)),
    remaining: Math.max(0, quota.limit_bytes - quota.used_bytes),
  };
}

export type ImportCheck = { ok: true } | { ok: false; message: string };

/** `maxFileBytes` : plafond d'un fichier (null = pas de plafond connu côté interface). */
export function canImport(
  fileBytes: number,
  quota: Quota,
  maxFileBytes: number | null,
): ImportCheck {
  if (maxFileBytes !== null && fileBytes > maxFileBytes)
    return {
      ok: false,
      message: `Ce fichier (${formatBytesFr(fileBytes)}) dépasse la taille maximale d’un fichier (${formatBytesFr(maxFileBytes)}).`,
    };
  const { remaining } = storageState(quota);
  if (remaining !== null && fileBytes > remaining)
    return {
      ok: false,
      message: `Ce fichier (${formatBytesFr(fileBytes)}) dépasse ton espace libre (${formatBytesFr(remaining)}). Archive puis supprime des sessions pour libérer de la place.`,
    };
  return { ok: true };
}
