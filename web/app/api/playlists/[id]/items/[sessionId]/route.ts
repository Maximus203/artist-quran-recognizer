import { json, notFound, safe } from "@/lib/http";
import { removeFromPlaylist } from "@/lib/playlists";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/** Retire un audio de la playlist (la session reste) : `{ removed: true }`. `404` si la playlist ou l'audio n'y est pas. */
async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; sessionId: string }> },
) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const { id: rawId, sessionId } = await params;
  const id = Number(rawId);
  const removed =
    Number.isInteger(id) &&
    id > 0 &&
    removeFromPlaylist(auth.db, id, auth.user.id, sessionId);
  return removed ? json({ removed: true }) : notFound("Audio introuvable");
}

export const DELETE = safe(handleDELETE);
