import { listFiles } from "@/lib/export-index";
import { json, safe } from "@/lib/http";
import { quotaView } from "@/lib/quota-view";
import { requireUser } from "@/lib/route-guard";
import { storageBreakdown } from "@/lib/session-index";
export const runtime = "nodejs";

/**
 * Fichiers téléchargeables gardés sur le serveur (vidéos exportées), le plus gros d'abord :
 * `{ scope, files: [{ id, session_id, session_name, owner_name, mine, name, bytes, created_at, download_url }],
 * total_bytes, quota: { used_bytes, limit_bytes, audio_bytes, video_bytes } }`. `scope` vaut `mine` (les
 * fichiers de MES sessions : c'est mon espace) ou `all` (administrateur). Pour supprimer :
 * `DELETE /api/sessions/<session_id>/videos/<id>` (propriétaire ou administrateur).
 */
async function handleGET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const files = listFiles(auth.db, auth.user);
  const quota = quotaView(auth.db, auth.user.id);
  return json({
    scope: auth.user.role === "admin" ? "all" : "mine",
    files: files.map((file) => ({
      id: file.id,
      session_id: file.sessionId,
      session_name: file.sessionName,
      owner_name: file.ownerName,
      mine: file.sessionOwnerId === auth.user.id,
      name: file.name,
      bytes: file.bytes,
      created_at: file.createdAt,
      download_url: `/api/sessions/${file.sessionId}/videos/${file.id}?download=1`,
    })),
    total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    quota: {
      ...storageBreakdown(auth.db, auth.user.id),
      used_bytes: quota.used_bytes,
      limit_bytes: quota.limit_bytes,
    },
  });
}

export const GET = safe(handleGET);
