import { revokeAllLogins } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { json, safe } from "@/lib/http";
import { clientIp, requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * « Fermer les autres connexions » : révoque côté serveur toutes les connexions du compte sauf celle
 * qui fait la demande (un appareil perdu, un navigateur partagé). `{ revoked: n }`.
 */
async function handleDELETE(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  if (!auth.token)
    return json(
      { error: "Connexion par cookie requise.", code: "forbidden" },
      403,
    );
  const before = (
    auth.db
      .prepare("SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?")
      .get(auth.user.id) as { n: number }
  ).n;
  revokeAllLogins(auth.db, auth.user.id, auth.token);
  audit("logins.revoked_others", {
    userId: auth.user.id,
    ip: clientIp(request, auth.cfg),
  });
  return json({ revoked: Math.max(0, before - 1) });
}

export const DELETE = safe(handleDELETE);
