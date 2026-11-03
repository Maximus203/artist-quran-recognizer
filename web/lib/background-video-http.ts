import { ClipError, type ClipContext } from "./background-video-store";
import { apiError } from "./http";
import { ImportError } from "./import-session";
import { sessionAccess, type Denied, type SessionAccess } from "./route-guard";

/**
 * Garde commune des routes de la vidéo de fond (`/api/sessions/:id/background-videos/…`) : connexion, droit de
 * voir la session (404 si elle est invisible pour ce compte), puis la vidéo est celle de CE compte pour CETTE
 * session (le magasin répond « inconnue » sinon). Les erreurs sortent toutes avec une phrase en français clair
 * et un code (`ClipCode`) que le client reconnaît.
 */
export type ClipParams = Promise<{ id: string; vid?: string; n?: string }>;

export type ClipRoute = {
  ok: true;
  access: SessionAccess;
  ctx: ClipContext;
};

export async function clipRoute(
  request: Request,
  params: ClipParams,
  options: { mutation?: boolean } = {},
): Promise<ClipRoute | Denied> {
  const access = await sessionAccess(request, params, "view", options);
  if (!access.ok) return access;
  const { vid } = await params;
  return {
    ok: true,
    access,
    ctx: { id: vid ?? "", sessionId: access.id, ownerId: access.user.id },
  };
}

/** Une erreur du magasin ou du cœur d'envoi, en réponse d'API ; toute autre erreur remonte (500 journalisé). */
export function clipFailure(error: unknown): Response {
  if (error instanceof ClipError)
    return apiError(error.status, error.message, { code: error.code });
  if (error instanceof ImportError)
    return apiError(error.status, error.message, {
      code:
        error.status === 413
          ? "too_big"
          : error.status === 409
            ? "incomplete"
            : error.status === 507
              ? "disk_full"
              : "invalid",
    });
  throw error;
}
