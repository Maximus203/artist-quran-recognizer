import { publicUser } from "@/lib/auth-response";
import { json, safe } from "@/lib/http";
import { readPreferences } from "@/lib/preferences";
import { quotaView } from "@/lib/quota-view";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Le compte connecté, ses préférences et son stockage : l'appel d'amorçage de l'interface.
 * `quota` = `{ used_bytes, limit_bytes (null = illimité), max_file_bytes, max_video_bytes }`.
 * `401 { code: "unauthenticated" }` sans connexion valide → l'interface redirige vers /login.
 */
async function handleGET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  return json({
    user: publicUser(auth.user),
    preferences: readPreferences(auth.db, auth.user.id).preferences,
    quota: quotaView(auth.db, auth.user.id),
  });
}

export const GET = safe(handleGET);
