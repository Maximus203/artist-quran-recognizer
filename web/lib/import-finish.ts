import { json } from "./http";
import { ensureQueueRecovered, launch } from "./jobs";
import type { SignedIn } from "./route-guard";
import { getMeta, markViewedBy } from "./session-index";
import { viewForUser } from "./session-service";
import type { Session } from "./store";

/**
 * Fin commune d'un import (envoi unique ou assemblage de morceaux) : mise en file de l'analyse si demandée,
 * puis réponse `201` avec la vue de la session. Un seul endroit : les deux chemins d'envoi répondent pareil.
 */
export async function respondCreated(
  auth: SignedIn,
  created: Session,
  autorun: boolean,
): Promise<Response> {
  // Un échec de mise en file ne perd pas l'import : la session reste « prête » et le dit.
  let autorunError: string | null = null;
  if (autorun && created.state === "ready") {
    try {
      await ensureQueueRecovered();
      await launch(created.id, undefined, auth.user.id);
    } catch (e) {
      autorunError = e instanceof Error ? e.message : "Mise en file impossible";
    }
  }
  // Un résultat joint à l'import est sous les yeux de l'utilisateur : pas de point « non lu ».
  if (created.state === "done")
    markViewedBy(auth.db, auth.user.id, created.id, new Date().toISOString());
  const meta = getMeta(auth.db, created.id);
  const view = meta ? await viewForUser(auth.db, auth.user, meta) : null;
  return json(
    { ...view, ...(autorunError ? { autorun_error: autorunError } : {}) },
    201,
  );
}
