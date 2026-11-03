import { audit } from "@/lib/audit";
import { BlockList } from "@/lib/blocklist";
import { apiError, safe } from "@/lib/http";
import { requireAdmin } from "@/lib/route-guard";
export const runtime = "nodejs";

/** Lève le blocage d'une adresse (administrateur) : `204`, ou `404` si l'empreinte n'est pas bloquée. */
async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ hash: string }> },
) {
  const auth = await requireAdmin(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const { hash } = await params;
  if (!/^[0-9a-f]{64}$/.test(hash) || !new BlockList(auth.db).lift(hash))
    return apiError(404, "Blocage introuvable.");
  audit("block.lifted", { userId: auth.user.id, reason: hash.slice(0, 12) });
  return new Response(null, { status: 204 });
}

export const DELETE = safe(handleDELETE);
