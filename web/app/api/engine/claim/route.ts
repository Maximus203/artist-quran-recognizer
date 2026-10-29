import { engineBroker, leaseSeconds } from "@/lib/engine-broker";
import { json, safe } from "@/lib/http";
import { requireAgent } from "@/lib/route-guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Attente maximale d'une réclamation (long polling) : sous le délai des intermédiaires (Traefik, tunnels). */
const MAX_WAIT_S = 25;

/**
 * Un agent du moteur réclame la plus ancienne analyse en attente (ADR-0017). `?wait=N` attend jusqu'à N secondes
 * (25 au plus). 200 avec le bail, ou 204 sans analyse. Le bail est prêté à CET agent seul, pour une durée limitée.
 */
async function handlePOST(request: Request) {
  const auth = await requireAgent(request);
  if (!auth.ok) return auth.response;
  const asked = Number(new URL(request.url).searchParams.get("wait") ?? 0);
  const waitS = Number.isFinite(asked)
    ? Math.min(MAX_WAIT_S, Math.max(0, Math.floor(asked)))
    : 0;
  const lease = await engineBroker().claimWait(
    auth.agent.id,
    waitS * 1000,
    request.signal,
  );
  if (!lease) return new Response(null, { status: 204 });
  return json({
    lease: lease.id,
    session: lease.ticket.id,
    asr: lease.ticket.asr,
    audio: {
      path: `/api/engine/leases/${lease.id}/audio`,
      sha256: lease.ticket.audioSha256,
      size: lease.ticket.audioSize,
    },
    lease_s: leaseSeconds(),
  });
}

export const POST = safe(handlePOST);
