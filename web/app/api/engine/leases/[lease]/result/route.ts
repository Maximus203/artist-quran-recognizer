import {
  MAX_RESULT_BYTES,
  UnknownLeaseError,
  engineBroker,
} from "@/lib/engine-broker";
import { apiError, json, notFound, safe } from "@/lib/http";
import { readBoundedBody } from "@/lib/read-bounded";
import { requireAgent } from "@/lib/route-guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Dépôt du résultat (`source.recognition.json`) de l'analyse prêtée à cet agent. Contrat de sortie et empreinte de
 * l'audio vérifiés ; un résultat refusé fait échouer l'analyse avec un message clair (l'agent est en défaut).
 */
async function handlePUT(
  request: Request,
  { params }: { params: Promise<{ lease: string }> },
) {
  const auth = await requireAgent(request);
  if (!auth.ok) return auth.response;
  const id = (await params).lease;
  const broker = engineBroker();
  if (!broker.lease(id, auth.agent.id))
    return notFound("Bail inconnu ou expiré");
  const body = await readBoundedBody(request, MAX_RESULT_BYTES);
  if (body === null) {
    broker.fail(id, auth.agent.id, "Résultat trop gros, refusé.");
    return apiError(413, "Résultat trop gros.", { code: "payload_too_large" });
  }
  try {
    await broker.complete(id, auth.agent.id, body);
  } catch (error) {
    if (error instanceof UnknownLeaseError)
      return notFound("Bail inconnu ou expiré");
    broker.fail(
      id,
      auth.agent.id,
      "Le moteur distant a rendu un résultat invalide (contrat de sortie ou empreinte de l'audio).",
    );
    return apiError(422, "Résultat refusé.", { code: "invalid_result" });
  }
  return json({ ok: true });
}

export const PUT = safe(handlePUT);
