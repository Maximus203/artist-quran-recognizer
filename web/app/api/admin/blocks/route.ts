import { BlockList } from "@/lib/blocklist";
import { json, safe } from "@/lib/http";
import { requireAdmin } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Adresses bloquées par les pièges (administrateur) : empreinte (jamais l'adresse), raison, nombre de
 * passages, début et fin. Pour lever un blocage : `DELETE /api/admin/blocks/{empreinte}`.
 */
async function handleGET(request: Request) {
  const auth = await requireAdmin(request);
  if (!auth.ok) return auth.response;
  const items = new BlockList(auth.db).active(200).map((row) => ({
    hash: row.hash,
    reason: row.reason,
    strikes: row.strikes,
    first_at: new Date(row.firstAt).toISOString(),
    last_at: new Date(row.lastAt).toISOString(),
    blocked_until: new Date(row.blockedUntil).toISOString(),
  }));
  return json({ items });
}

export const GET = safe(handleGET);
