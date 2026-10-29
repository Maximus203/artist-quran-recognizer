import { changePassword } from "@/lib/auth";
import { z } from "zod";
import { parseBody } from "@/lib/body";
import { apiError, safe } from "@/lib/http";
import { authDeps, clientIp, requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

const passwordBody = z
  .object({ current: z.string().max(128), next: z.string().max(128) })
  .strict();

/** Changement de mot de passe : `{ current, next }` → `204`. Les autres connexions du compte sont révoquées. */
async function handlePOST(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const body = await parseBody(request, passwordBody, "{ current, next }");
  if (!body.ok) return body.response;
  const deps = await authDeps();
  const result = await changePassword(
    deps,
    auth.user,
    auth.token,
    body.data,
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
