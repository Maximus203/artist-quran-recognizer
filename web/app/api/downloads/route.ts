import { buildDownloads } from "@/lib/downloads";
import { json, safe } from "@/lib/http";
import { quotaView } from "@/lib/quota-view";
import { requireUser } from "@/lib/route-guard";
import { storageBreakdown } from "@/lib/session-index";
import { allVideoJobs } from "@/lib/video-jobs";
export const runtime = "nodejs";

/**
 * Tous les téléchargements, regroupés par génération : les vidéos prêtes (gardées sur le serveur) et les
 * exports de la file (en attente, en cours, échoués, terminés mais non gardés).
 * `{ scope, groups: [{ session_id, session_name, owner_name, mine, active, items }], total_bytes, active,
 * quota }`. Chaque `item` est un `file` (`download_url`, `can_delete`) ou un `job` (`state`, `progress`, `ratio`,
 * `error`, `downloads`, `can_cancel`). Visibilité (appliquée ici, côté serveur) : le compte voit ses
 * générations et les publiques ; ses propres exports en file ; l'administrateur voit tout. `scope` vaut
 * `all` (administrateur) ou `mine`. Supprimer un fichier : `DELETE /api/sessions/<session_id>/videos/<id>` ;
 * annuler un export : `DELETE /api/sessions/<session_id>/export/video/jobs/<id>`.
 */
async function handleGET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const downloads = buildDownloads(auth.db, auth.user, allVideoJobs());
  const quota = quotaView(auth.db, auth.user.id);
  return json({
    scope: auth.user.role === "admin" ? "all" : "mine",
    ...downloads,
    quota: {
      ...storageBreakdown(auth.db, auth.user.id),
      used_bytes: quota.used_bytes,
      limit_bytes: quota.limit_bytes,
    },
  });
}

export const GET = safe(handleGET);
