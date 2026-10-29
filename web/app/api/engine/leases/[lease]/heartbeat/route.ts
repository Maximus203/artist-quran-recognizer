import { engineBroker } from "@/lib/engine-broker";
import { json, notFound, safe } from "@/lib/http";
import { requireAgent } from "@/lib/route-guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signal de vie : prolonge le bail. `{ cancel: true }` si l'utilisateur a annulé l'analyse (l'agent s'arrête). */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ lease: string }> },
) {
  const auth = await requireAgent(request);
  if (!auth.ok) return auth.response;
  const result = engineBroker().heartbeat((await params).lease, auth.agent.id);
  if (!result) return notFound("Bail inconnu ou expiré");
  return json(result);
}

export const POST = safe(handlePOST);
