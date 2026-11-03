import { decisionsView, updateDecisions } from "@/lib/decisions-store";
import { exportErrorResponse } from "@/lib/export-errors";
import { json, readJson, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Le calque de décisions humaines d'une session (`aqr.decisions/1`, ADR-0014). Il se superpose à la
 * prédiction du moteur sans jamais la modifier.
 *
 * GET : toutes les décisions avec leur état (appliquée, orpheline, annulée…), le consentement
 * d'entraînement et, pour chaque orpheline, le passage du moteur le plus proche (une suggestion).
 * PUT : `{ ops: [...] }`, le serveur fixe l'empreinte, l'auteur, la date et la révision :
 * `decide`, `withdraw`, `consent` et `training` (propriétaire seulement), `reattach`. Un
 * non-propriétaire qui n'est pas administrateur reçoit 403 ; un audio privé d'un autre, 404.
 */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  try {
    return json({
      decisions: await decisionsView(access.id, {
        username: access.user.username,
        isOwner: access.meta.owner_id === access.user.id,
        isAdmin: access.user.role === "admin",
      }),
    });
  } catch (error) {
    return exportErrorResponse(error) ?? Promise.reject(error);
  }
}

async function handlePUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "edit", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  try {
    return json({
      decisions: await updateDecisions(access.id, await readJson(request), {
        username: access.user.username,
        isOwner: access.meta.owner_id === access.user.id,
        isAdmin: access.user.role === "admin",
      }),
    });
  } catch (error) {
    return exportErrorResponse(error) ?? Promise.reject(error);
  }
}

export const GET = safe(handleGET);
export const PUT = safe(handlePUT);
