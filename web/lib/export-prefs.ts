/**
 * Les réglages d'export sont sur le COMPTE (préférences serveur, `preferences-schema.ts`), pas sur
 * l'appareil : un navigateur partagé par plusieurs comptes ne doit jamais mêler leurs réglages.
 * Ce module ne fait plus que le nettoyage des anciennes clés « par appareil », une seule fois.
 */
export const LEGACY_DEVICE_EXPORT_KEYS = [
  "aqr.ui.v1.export",
  "aqr.ui.v1.export-video",
] as const;

type Store = Pick<Storage, "removeItem">;

/** Retire les réglages d'export gardés par l'ancien système (un par navigateur, partagé par tous les comptes). */
export function forgetDeviceExportPrefs(storage: Store | null): void {
  for (const key of LEGACY_DEVICE_EXPORT_KEYS) {
    try {
      storage?.removeItem(key);
    } catch {
      /* stockage bloqué : rien à retirer */
    }
  }
}
