import { json, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { listVideos } from "@/lib/video-library";
export const runtime = "nodejs";

/**
 * Vidéos déjà fabriquées pour cet enregistrement (gardées sur le serveur), la plus récente d'abord :
 * `{ videos: [{ id, name, key, label, bytes, created_at }], total_bytes }`. Tout lecteur de la session
 * les voit ; 404 pour l'audio privé d'un autre.
 */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  const videos = await listVideos(access.id);
  return json({
    videos,
    total_bytes: videos.reduce((sum, v) => sum + v.bytes, 0),
  });
}

export const GET = safe(handleGET);
