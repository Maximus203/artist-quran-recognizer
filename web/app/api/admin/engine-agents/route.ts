import { z } from "zod";
import {
  AgentLimitError,
  cleanAgentName,
  createAgent,
  engineOnline,
  listAgents,
} from "@/lib/engine-agents";
import { parseBody } from "@/lib/body";
import { engineBroker, remoteEngineEnabled } from "@/lib/engine-broker";
import { apiError, json, safe } from "@/lib/http";
import { log } from "@/lib/log";
import { requireAdmin } from "@/lib/route-guard";
export const runtime = "nodejs";

const schema = z.object({ name: z.string().min(1).max(80) }).strict();

/** Agents du moteur à distance (administrateur) : liste, et état « en ligne » du moteur. */
async function handleGET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const remote = remoteEngineEnabled();
  return json({
    remote,
    online: engineOnline(auth.db),
    // File d'attente du courtier (en mémoire) : seulement pertinente quand le moteur est distant.
    queue: remote ? engineBroker().status() : null,
    items: listAgents(auth.db),
  });
}

/** Crée un agent. Le jeton clair n'est rendu qu'ici, une seule fois. */
async function handlePOST(request: Request) {
  const auth = await requireAdmin(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, schema, "{ name }");
  if (!body.ok) return body.response;
  const name = cleanAgentName(body.data.name);
  if (!name)
    return apiError(400, "Nom invalide (1 à 60 caractères).", {
      code: "invalid",
      field: "name",
    });
  try {
    const { token, row } = createAgent(auth.db, {
      name,
      createdBy: auth.user.id,
    });
    log.event(
      "security",
      "engine_agent.created",
      { agent: row.id, by: auth.user.id },
      "warn",
    );
    return json({ token, agent: row }, 201, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error instanceof AgentLimitError)
      return apiError(409, error.message, { code: "limit" });
    throw error;
  }
}

export const GET = safe(handleGET);
export const POST = safe(handlePOST);
