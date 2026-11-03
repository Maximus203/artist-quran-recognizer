import { revokeApiToken } from "@/lib/api-tokens";
import { audit } from "@/lib/audit";
import { apiError, safe } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/** Révocation immédiate d'un jeton du compte : `204`, ou `404` s'il n'existe pas ou l'est déjà. */
async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1)
    return apiError(404, "Jeton introuvable.");
  if (!revokeApiToken(auth.db, auth.user.id, id))
    return apiError(404, "Jeton introuvable.");
  audit("token.revoked", { userId: auth.user.id });
  return new Response(null, { status: 204 });
}

export const DELETE = safe(handleDELETE);
