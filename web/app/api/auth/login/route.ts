import { loginAccount } from "@/lib/auth";
import { authResponse } from "@/lib/auth-response";
import { apiError, readJson } from "@/lib/http";
import { authDeps, authenticate, clientIp } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Connexion : `{ username, password }` → `200 { user }` + cookie `aqr_session`.
 * `401` générique (jamais « ce pseudonyme n'existe pas »), `429` avec `Retry-After` après
 * plusieurs échecs (verrouillage progressif par IP + pseudonyme).
 */
export async function POST(request: Request) {
  const guard = await authenticate(request, {
    mutation: true,
    anonymous: true,
  });
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body))
    return apiError(400, "Corps JSON attendu : { username, password }.");
  const deps = await authDeps();
  const result = await loginAccount(
    deps,
    body as { username: unknown; password: unknown },
    clientIp(request, deps.cfg),
  );
  return authResponse(request, deps.cfg, result, 200);
}
