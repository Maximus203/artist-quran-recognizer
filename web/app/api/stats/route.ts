import { ensureQueueRecovered } from "@/lib/jobs";
import { json } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
import { statsForUser } from "@/lib/session-service";
export const runtime = "nodejs";
/**
 * Performance du moteur d'après les sessions VISIBLES de l'utilisateur (les globales et les
 * siennes — jamais le privé d'un autre) : par moteur, nombre d'analyses, facteur temps réel
 * (médiane, p90, moyenne), durées totales et modèle d'estimation ; file courante, dernières
 * analyses, `totals` (sessions, taille des audios, heures) et `disk` (espace utilisé par ces
 * sessions, espace libre et total du volume). Calcul pur sur l'index, aucune donnée nouvelle.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  await ensureQueueRecovered().catch(() => []);
  return json(await statsForUser(auth.db, auth.user));
}
