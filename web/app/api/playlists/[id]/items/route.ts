import { z } from "zod";
import { parseBody } from "@/lib/body";
import { apiError, json, notFound, safe } from "@/lib/http";
import { PlaylistFullError, addToPlaylist } from "@/lib/playlists";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

const schema = z
  .object({ session_ids: z.array(z.string().min(1).max(64)).min(1).max(200) })
  .strict();

/**
 * Ajoute des audios à la fin de la playlist : `{ added, skipped }`. Passent seulement les sessions que le compte
 * voit, une fois chacune. `404` si la playlist n'est pas à lui ; `409` au-delà de 200 audios.
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const body = await parseBody(request, schema, "{ session_ids }");
  if (!body.ok) return body.response;
  try {
    const result =
      Number.isInteger(id) && id > 0
        ? addToPlaylist(auth.db, id, auth.user, body.data.session_ids)
        : null;
    return result ? json(result) : notFound("Playlist introuvable");
  } catch (error) {
    if (error instanceof PlaylistFullError)
      return apiError(409, error.message, { code: "limit" });
    throw error;
  }
}

export const POST = safe(handlePOST);
