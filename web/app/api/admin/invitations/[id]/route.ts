import { json, notFound, safe } from "@/lib/http";
import { revokeInvitation } from "@/lib/invitations";
import { log } from "@/lib/log";
import { requireAdmin } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Révoque une invitation : le lien ne donne plus ni accès ni inscription à la requête suivante. Un cookie
 * d'accès déjà délivré reste valable jusqu'à son expiration (durée de `AQR_ACCESS_TTL_S`) ; les comptes déjà
 * créés ne sont pas touchés (les désactiver se fait dans Comptes).
 */
async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const raw = (await params).id;
  const id = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(id) ||
    !revokeInvitation(auth.db, id)
  )
    return notFound("Invitation introuvable");
  log.event(
    "security",
    "invitation.revoked",
    { invitation: id, by: auth.user.id },
    "warn",
  );
  return json({ ok: true });
}

export const DELETE = safe(handleDELETE);
