import { registerAccount, type Registration } from "@/lib/auth";
import { authResponse } from "@/lib/auth-response";
import { apiError, readJson, safe } from "@/lib/http";
import { authDeps, authenticate, clientIp } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Inscription : `{ username, password, code? }` → `201 { user }` + cookie `aqr_session`.
 * Le premier compte de l'atelier est administrateur. `400` (champ fautif dans `field`), `403`
 * (inscriptions fermées / code invalide), `409` (pseudonyme pris), `429` (trop d'essais).
 */
async function handlePOST(request: Request) {
  const guard = await authenticate(request, {
    mutation: true,
    anonymous: true,
  });
  if (!guard.ok) return guard.response;
  const body = await readJson(request);
  if (!body || typeof body !== "object" || Array.isArray(body))
    return apiError(400, "Corps JSON attendu : { username, password }.");
  const deps = await authDeps();
  const result = await registerAccount(
    deps,
    body as Registration,
    clientIp(request, deps.cfg),
  );
  return authResponse(request, deps.cfg, result, 201);
}

export const POST = safe(handlePOST);
