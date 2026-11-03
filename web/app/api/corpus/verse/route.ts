import { corpusVerse } from "@/lib/export-engine";
import { exportErrorResponse } from "@/lib/export-errors";
import { json, safe } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Un verset (ou une plage de mots) lu DANS LE CORPUS : texte arabe mot par mot, nombre de mots,
 * traduction QuranEnc. Sert à valider un verset saisi dans l'écran de correction (« ✓ Verset trouvé,
 * 22 mots »). Jamais un texte venu d'un modèle (I1). `?ref=11:61&words=11-17`. Connexion requise.
 */
async function handleGET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  try {
    const query = new URL(request.url).searchParams;
    const found = await corpusVerse(query.get("ref") ?? "", query.get("words"));
    return json(found, found.ok ? 200 : 404);
  } catch (error) {
    return exportErrorResponse(error) ?? Promise.reject(error);
  }
}

export const GET = safe(handleGET);
