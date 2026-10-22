import { apiError, json } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { markViewedBy, viewState } from "@/lib/session-index";
import { readSession } from "@/lib/store";
export const runtime = "nodejs";
/**
 * « J'ai ouvert le résultat » : enregistre l'ouverture POUR CET UTILISATEUR (idempotent tant que
 * l'analyse n'est pas refaite). Seul le propriétaire d'une session terminée la voit « non lue » ;
 * un autre testeur peut l'ouvrir sans rien changer pour lui. Un `GET` ne marque jamais comme vu.
 * Sans effet tant que la session n'est pas terminée.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  try {
    const session = await readSession(access.id);
    if (session.state === "done" || session.state === "failed")
      markViewedBy(
        access.db,
        access.user.id,
        access.id,
        new Date().toISOString(),
      );
    const view = viewState(access.db, access.user.id, access.id);
    return json({
      id: session.id,
      state: session.state,
      viewed_at: view.viewed_at,
      unread: view.unread,
    });
  } catch {
    return apiError(404, "Session introuvable", { code: "not_found" });
  }
}
