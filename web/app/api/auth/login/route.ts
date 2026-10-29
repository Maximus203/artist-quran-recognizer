import { loginAccount } from "@/lib/auth";
import { authResponse } from "@/lib/auth-response";
import { z } from "zod";
import { parseBody } from "@/lib/body";
import { safe } from "@/lib/http";
import { authDeps, authenticate, clientIp } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Connexion : `{ username, password }` → `200 { user }` + cookie `aqr_session`.
 * `401` générique (jamais « ce pseudonyme n'existe pas »), `429` avec `Retry-After` après
 * plusieurs échecs (verrouillage progressif par IP + pseudonyme).
 */
const loginBody = z
  .object({ username: z.string().max(100), password: z.string().max(128) })
  .strict();

async function handlePOST(request: Request) {
  const guard = await authenticate(request, {
    mutation: true,
    anonymous: true,
  });
  if (!guard.ok) return guard.response;
  const body = await parseBody(request, loginBody, "{ username, password }");
  if (!body.ok) return body.response;
  const deps = await authDeps();
  const result = await loginAccount(
    deps,
    body.data,
    clientIp(request, deps.cfg),
  );
  return authResponse(request, deps.cfg, result, 200);
}

export const POST = safe(handlePOST);
