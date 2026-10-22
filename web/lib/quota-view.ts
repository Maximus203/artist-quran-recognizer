import type { Db } from "./db";
import { userQuotaBytes } from "./quota";
import { usedBytes } from "./session-index";
import { uploadLimitBytes, videoUploadLimitBytes } from "./store";

/**
 * Ce que l'interface sait du stockage d'un compte : espace utilisé, quota (`null` = illimité) et
 * taille maximale d'un fichier (audio, vidéo). Une seule construction pour `GET /api/me` et pour
 * les pages rendues côté serveur.
 */
export type QuotaView = {
  used_bytes: number;
  limit_bytes: number | null;
  max_file_bytes: number;
  max_video_bytes: number;
};

export function quotaView(db: Db, userId: number): QuotaView {
  const limit = userQuotaBytes();
  return {
    used_bytes: usedBytes(db, userId),
    limit_bytes: limit || null,
    max_file_bytes: uploadLimitBytes(),
    max_video_bytes: videoUploadLimitBytes(),
  };
}
