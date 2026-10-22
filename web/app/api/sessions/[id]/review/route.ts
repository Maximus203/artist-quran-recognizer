import { apiError, json, readJson } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { updateReviewAs } from "@/lib/review-update";
import { readReview } from "@/lib/store";
export const runtime = "nodejs";

/** La revue d'une session (tous testeurs confondus) : sert au rafraîchissement du panneau. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "review");
  if (!access.ok) return access.response;
  try {
    return json({ review: await readReview(access.id) });
  } catch {
    return apiError(404, "Session introuvable", { code: "not_found" });
  }
}

/**
 * Enregistre les signalements du testeur connecté : fusion par identifiant avec ceux des autres
 * (jamais un remplacement de la liste). L'AUTEUR est le compte connecté — le champ `tester` envoyé
 * par le client est ignoré. Un signalement d'un autre testeur ne se modifie ni ne se supprime
 * (administrateurs exceptés) : ces identifiants reviennent dans `rejected`.
 * Réponse : `{ saved: true, review, rejected: string[] }`.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "review", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  try {
    const { review, rejected } = await updateReviewAs(
      access.id,
      await readJson(request),
      {
        username: access.user.username,
        admin: access.user.role === "admin",
      },
    );
    return json({ saved: true, review, rejected });
  } catch (e) {
    return apiError(
      400,
      e instanceof Error ? e.message : "Sauvegarde impossible",
    );
  }
}
