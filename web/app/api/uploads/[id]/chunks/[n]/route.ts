import { receiveChunk } from "@/lib/chunked-upload";
import { apiError, json, safe } from "@/lib/http";
import { CHUNK_BODY_MAX } from "@/lib/http-security";
import { ImportError } from "@/lib/import-session";
import { readBoundedBody } from "@/lib/read-bounded";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Un morceau d'un envoi, en octets bruts. Renvoyer le même morceau est sans risque (reprise). La taille
 * attendue est exacte (morceau plein, sauf le dernier) ; un corps plus gros que le plafond est coupé en route.
 */
async function handlePUT(
  request: Request,
  { params }: { params: Promise<{ id: string; n: string }> },
) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const { id, n } = await params;
  if (!/^\d{1,9}$/.test(n))
    return apiError(400, "Numéro de morceau invalide.", { code: "invalid" });
  const body = await readBoundedBody(request, CHUNK_BODY_MAX);
  if (body === null)
    return apiError(413, "Morceau trop gros.", { code: "too_large" });
  try {
    const result = await receiveChunk({
      id,
      ownerId: auth.user.id,
      index: Number(n),
      body,
    });
    return json(result);
  } catch (error) {
    if (error instanceof ImportError)
      return apiError(error.status, error.message, {
        code: error.status === 413 ? "too_large" : "invalid",
      });
    throw error;
  }
}

export const PUT = safe(handlePUT);
