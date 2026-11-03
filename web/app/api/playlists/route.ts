import { z } from "zod";
import { parseBody } from "@/lib/body";
import { apiError, json, safe } from "@/lib/http";
import {
  PlaylistFullError,
  PlaylistLimitError,
  addToPlaylist,
  cleanPlaylistName,
  createPlaylist,
  listPlaylists,
} from "@/lib/playlists";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

const schema = z
  .object({
    name: z.string().min(1).max(200),
    /** Audios à y mettre d'emblée (« Ajouter à une nouvelle playlist »). */
    session_ids: z.array(z.string().min(1).max(64)).max(200).optional(),
  })
  .strict();

/** Les playlists du compte connecté : `{ items: [{ id, name, count, duration_s, updated_at }] }`. */
async function handleGET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  return json({ items: listPlaylists(auth.db, auth.user) });
}

/** Crée une playlist `{ name, session_ids? }` : `201 { playlist, added? }`. `409` au-delà de 50 playlists. */
async function handlePOST(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, schema, "{ name, session_ids? }");
  if (!body.ok) return body.response;
  const name = cleanPlaylistName(body.data.name);
  if (!name)
    return apiError(400, "Le nom fait 1 à 60 caractères.", {
      code: "invalid",
      field: "name",
    });
  try {
    const playlist = createPlaylist(auth.db, auth.user.id, name);
    const added = body.data.session_ids?.length
      ? addToPlaylist(auth.db, playlist.id, auth.user, body.data.session_ids)
      : null;
    return json({ playlist, added }, 201);
  } catch (error) {
    if (
      error instanceof PlaylistLimitError ||
      error instanceof PlaylistFullError
    )
      return apiError(409, error.message, { code: "limit" });
    throw error;
  }
}

export const GET = safe(handleGET);
export const POST = safe(handlePOST);
