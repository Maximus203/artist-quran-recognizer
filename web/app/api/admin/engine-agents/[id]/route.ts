import { revokeAgent } from "@/lib/engine-agents";
import { json, notFound, safe } from "@/lib/http";
import { log } from "@/lib/log";
import { requireAdmin } from "@/lib/route-guard";
export const runtime = "nodejs";

/** Révoque un agent : son jeton ne marche plus à la requête suivante. */
async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || !revokeAgent(auth.db, id))
    return notFound("Agent introuvable");
  log.event(
    "security",
    "engine_agent.revoked",
    { agent: id, by: auth.user.id },
    "warn",
  );
  return json({ ok: true });
}

export const DELETE = safe(handleDELETE);
