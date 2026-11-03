import { z } from "zod";
import {
  clipFailure,
  clipRoute,
  type ClipParams,
} from "@/lib/background-video-http";
import {
  clipLimitsNow,
  createClip,
  listClips,
} from "@/lib/background-video-store";
import { parseBody } from "@/lib/body";
import { json, safe } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    filename: z.string().min(1).max(500),
    size: z.number().int().min(0),
  })
  .strict();

const limitsBody = () => {
  const limits = clipLimitsNow();
  return {
    max_bytes: limits.maxBytes,
    max_seconds: limits.maxSeconds,
    max_clips: limits.maxClips,
  };
};

/**
 * Les vidéos de fond de CE compte pour cette session, et les plafonds (poids, durée, nombre) : de quoi les dire
 * à l'utilisateur AVANT qu'il choisisse un fichier. `{ limits, videos }`.
 */
async function handleGET(request: Request, { params }: { params: ClipParams }) {
  const route = await clipRoute(request, params);
  if (!route.ok) return route.response;
  const videos = await listClips(route.ctx);
  return json({ limits: limitsBody(), videos });
}

/**
 * Début d'un envoi : `{ filename, size }` → `201 { id, chunk_size, chunks, size, limits }`. Format, poids, nombre de
 * vidéos et place disque sont contrôlés ICI, avant le premier octet. Ensuite : `PUT …/<id>/chunks/<n>` pour chaque
 * morceau (reprenable), puis `POST …/<id>/complete`.
 */
async function handlePOST(
  request: Request,
  { params }: { params: ClipParams },
) {
  const route = await clipRoute(request, params, { mutation: true });
  if (!route.ok) return route.response;
  const body = await parseBody(request, schema, "{ filename, size }");
  if (!body.ok) return body.response;
  try {
    const created = await createClip({
      sessionId: route.ctx.sessionId,
      ownerId: route.ctx.ownerId,
      filename: body.data.filename,
      size: body.data.size,
    });
    return json(
      {
        id: created.id,
        chunk_size: created.chunk_size,
        chunks: created.chunks,
        size: created.size,
        limits: limitsBody(),
      },
      201,
    );
  } catch (error) {
    return clipFailure(error);
  }
}

export const GET = safe(handleGET);
export const POST = safe(handlePOST);
