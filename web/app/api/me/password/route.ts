import { changePassword } from "@/lib/auth";
import { apiError, readJson, safe } from "@/lib/http";
import { authDeps, clientIp, requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/** Changement de mot de passe : `{ current, next }` → `204`. Les autres connexions du compte sont révoquées. */
async function handlePOST(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const body = (await readJson(request)) as
    | { current?: unknown; next?: unknown }
    | undefined;
  if (!body || typeof body !== "object")
    return apiError(400, "Corps JSON attendu : { current, next }.");
  const deps = await authDeps();
  const result = await changePassword(
    deps,
    auth.user,
    auth.token,
    { current: body.current, next: body.next },
    clientIp(request, deps.cfg),
  );
  if (!result.ok)
    return apiError(result.status, result.message, {
      code: result.status === 429 ? "rate_limited" : "invalid",
      field: result.field,
      headers: result.retryAfterS
        ? { "Retry-After": String(result.retryAfterS) }
        : undefined,
    });
  return new Response(null, { status: 204 });
}

export const POST = safe(handlePOST);
