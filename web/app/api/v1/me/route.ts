import { json, safe } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/** Qui parle : le compte et, pour un jeton d'API, son nom, son préfixe et ses droits. */
async function handleGET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  return json({
    user: { id: auth.user.id, username: auth.user.username },
    token: auth.api
      ? {
          name: auth.api.name,
          prefix: auth.api.prefix,
          scope: auth.api.scope,
          expires_at: auth.api.expires_at,
        }
      : null,
  });
}

export const GET = safe(handleGET);
