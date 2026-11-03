"use client";
import { formatBytesFr } from "@/lib/format";
import { storageState, type Quota } from "@/lib/storage-meter";
import { Icon } from "./icons";
import { useShell } from "./shell";

/**
 * Espace du compte presque plein : visible partout, avant que l'import ne soit bloqué. Le testeur voit
 * combien il utilise et ce qu'il peut libérer ; l'administrateur voit la même chose dans l'onglet
 * « Testeurs », où les comptes proches de la limite sont signalés.
 */
export function StorageNotice() {
  const { quota } = useShell();
  const space = storageState(quota);
  const visible = space.state !== "ok";
  return (
    <div
      className="prefs-notice"
      role="status"
      aria-live="polite"
      data-testid="storage-notice"
      data-state={space.state}
      data-visible={visible}
    >
      {visible ? (
        <>
          <Icon name="alert" />
          <span>{storageMessage(quota, space.state === "full")}</span>
        </>
      ) : null}
    </div>
  );
}

export function storageMessage(quota: Quota, full: boolean): string {
  const used = formatBytesFr(quota.used_bytes);
  const limit = quota.limit_bytes ? formatBytesFr(quota.limit_bytes) : "—";
  if (full)
    return `Espace plein (${used} sur ${limit}) : les imports sont bloqués. Supprime des sessions ou des vidéos gardées pour continuer.`;
  return `Espace presque plein (${used} sur ${limit}). Supprime les sessions et vidéos dont tu n’as plus besoin avant d’importer.`;
}
