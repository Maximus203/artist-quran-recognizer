import { ensureQueueRecovered } from "@/lib/jobs";
import { json, safe } from "@/lib/http";
import { queueStatusFor } from "@/lib/queue-status";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Ce que l'appelant peut savoir de la file : ses propres jobs (état, position, attente estimée) et,
 * pour les autres comptes, seulement des nombres : jamais un titre, un nom ni un identifiant d'une
 * génération privée. Une génération publique est visible de tous (`others.shared`).
 */
async function handleGET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  await ensureQueueRecovered().catch(() => []);
  return json(queueStatusFor(auth.db, auth.user));
}

export const GET = safe(handleGET);
