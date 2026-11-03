import { z } from "zod";
import { parseBody } from "@/lib/body";
import { apiError, json, notFound, safe } from "@/lib/http";
import {
  cleanPlaylistName,
  deletePlaylist,
  getPlaylist,
  renamePlaylist,
  reorderPlaylist,
} from "@/lib/playlists";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

const schema = z
  .object({
    name: z.string().min(1).max(200),
    /** Nouvel ordre : exactement les audios actuels, dans l'ordre voulu. */
    order: z.array(z.string().min(1).max(64)).max(200),
  })
  .partial()
  .strict();

const idOf = async (
  params: Promise<{ id: string }>,
): Promise<number | null> => {
  const id = Number((await params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const missing = () => notFound("Playlist introuvable");

/** Une playlist et ses audios lisibles, dans l'ordre. `404` si elle n'est pas au compte connecté. */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const id = await idOf(params);
  const playlist = id === null ? null : getPlaylist(auth.db, id, auth.user);
  return playlist ? json({ playlist }) : missing();
}

/** Renomme (`name`) et/ou réordonne (`order`). `400` pour un nom invalide, `409` si `order` n'est pas une permutation. */
async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const id = await idOf(params);
  if (id === null || !getPlaylist(auth.db, id, auth.user)) return missing();
  const body = await parseBody(request, schema, "{ name?, order? }");
  if (!body.ok) return body.response;
  if (body.data.name !== undefined) {
    const name = cleanPlaylistName(body.data.name);
    if (!name)
      return apiError(400, "Le nom fait 1 à 60 caractères.", {
        code: "invalid",
        field: "name",
      });
    renamePlaylist(auth.db, id, auth.user.id, name);
  }
  if (
    body.data.order !== undefined &&
    !reorderPlaylist(auth.db, id, auth.user, body.data.order)
  )
    return apiError(
      409,
      "L'ordre doit contenir exactement les audios de la playlist.",
      { code: "order" },
    );
  return json({ playlist: getPlaylist(auth.db, id, auth.user) });
}

/** Supprime la playlist (les audios restent). `204`. */
async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const id = await idOf(params);
  if (id === null || !deletePlaylist(auth.db, id, auth.user.id))
    return missing();
  return new Response(null, { status: 204 });
}

export const GET = safe(handleGET);
export const PATCH = safe(handlePATCH);
export const DELETE = safe(handleDELETE);
