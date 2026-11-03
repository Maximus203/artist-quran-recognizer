import {
  clipFailure,
  clipRoute,
  type ClipParams,
} from "@/lib/background-video-http";
import { abortClip, clipStatus } from "@/lib/background-video-store";
import { json, safe } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: ClipParams };

/**
 * État d'une vidéo de fond : morceaux reçus (pour reprendre après une coupure), puis préparation
 * (`state: processing`, `ratio`), puis `ready` avec la durée et la taille, ou `failed` avec la raison en clair.
 * Chaque lecture repousse l'expiration d'une vidéo prête.
 */
async function handleGET(request: Request, { params }: Props) {
  const route = await clipRoute(request, params);
  if (!route.ok) return route.response;
  try {
    return json(await clipStatus(route.ctx));
  } catch (error) {
    return clipFailure(error);
  }
}

/** Abandon ou retrait : tout ce qui a été reçu ou préparé est supprimé, la préparation en cours est arrêtée. */
async function handleDELETE(request: Request, { params }: Props) {
  const route = await clipRoute(request, params, { mutation: true });
  if (!route.ok) return route.response;
  try {
    await abortClip(route.ctx);
    return json({ ok: true });
  } catch (error) {
    return clipFailure(error);
  }
}

export const GET = safe(handleGET);
export const DELETE = safe(handleDELETE);
