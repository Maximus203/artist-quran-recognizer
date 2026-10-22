import { publicUser } from "@/lib/auth-response";
import { json } from "@/lib/http";
import { readPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/route-guard";
import { usedBytes } from "@/lib/session-index";
import { userQuotaBytes } from "@/lib/quota";
export const runtime = "nodejs";

/**
 * Le compte connecté, ses préférences et son quota : l'appel d'amorçage de l'interface.
 * `401 { code: "unauthenticated" }` sans connexion valide → l'interface redirige vers /login.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const limit = userQuotaBytes();
  return json({
    user: publicUser(auth.user),
    preferences: readPreferences(auth.db, auth.user.id).preferences,
    quota: {
      used_bytes: usedBytes(auth.db, auth.user.id),
      limit_bytes: limit || null,
    },
  });
}
