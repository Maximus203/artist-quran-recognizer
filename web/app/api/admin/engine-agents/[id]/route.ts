import { z } from "zod";
import { moveAgent, revokeAgent } from "@/lib/engine-agents";
import { apiError, json, notFound, readJson, safe } from "@/lib/http";
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

const move = z.object({ move: z.enum(["up", "down"]) }).strict();

/**
 * Change l'ordre de préférence : `{ move: "up" | "down" }` monte ou descend l'agent d'un cran (premier choix en
 * haut, secours en dessous). `409` s'il est déjà au bout, `404` s'il est inconnu ou révoqué.
 */
async function handlePATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const raw = (await params).id;
  const id = Number(raw);
  const parsed = move.safeParse(await readJson(request));
  if (!/^\d+$/.test(raw) || !Number.isInteger(id))
    return notFound("Agent introuvable");
  if (!parsed.success)
    return apiError(400, 'Corps attendu : { move: "up" | "down" }.', {
      code: "invalid",
    });
  const known = auth.db
    .prepare("SELECT 1 FROM engine_agents WHERE id = ? AND revoked_at IS NULL")
    .get(id);
  if (!known) return notFound("Agent introuvable");
  if (!moveAgent(auth.db, id, parsed.data.move))
    return apiError(
      409,
      parsed.data.move === "up"
        ? "Cet agent est déjà le premier choix."
        : "Cet agent est déjà le dernier.",
      { code: "edge" },
    );
  log.event(
    "security",
    "engine_agent.moved",
    { agent: id, move: parsed.data.move, by: auth.user.id },
    "info",
  );
  return json({ ok: true });
}

export const DELETE = safe(handleDELETE);
export const PATCH = safe(handlePATCH);
