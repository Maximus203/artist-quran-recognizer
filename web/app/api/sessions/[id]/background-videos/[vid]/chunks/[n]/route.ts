import {
  clipFailure,
  clipRoute,
  type ClipParams,
} from "@/lib/background-video-http";
import { receiveClipChunk } from "@/lib/background-video-store";
import { apiError, json, safe } from "@/lib/http";
import { CHUNK_BODY_MAX } from "@/lib/http-security";
import { readBoundedBody } from "@/lib/read-bounded";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Un morceau d'une vidéo de fond, en octets bruts. Renvoyer le même morceau est sans risque (reprise). La taille
 * attendue est exacte (morceau plein, sauf le dernier) ; un corps plus gros que le plafond est coupé en route.
 */
async function handlePUT(request: Request, { params }: { params: ClipParams }) {
  const route = await clipRoute(request, params, { mutation: true });
  if (!route.ok) return route.response;
  const { n } = await params;
  if (!/^\d{1,9}$/.test(n ?? ""))
    return apiError(400, "Numéro de morceau invalide.", { code: "invalid" });
  const body = await readBoundedBody(request, CHUNK_BODY_MAX);
  if (body === null)
    return apiError(413, "Morceau trop gros.", { code: "too_big" });
  try {
    return json(
      await receiveClipChunk({ ...route.ctx, index: Number(n), body }),
    );
  } catch (error) {
    return clipFailure(error);
  }
}

export const PUT = safe(handlePUT);
