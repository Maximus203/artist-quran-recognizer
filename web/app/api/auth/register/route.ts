import { registerAccount } from "@/lib/auth";
import { authResponse } from "@/lib/auth-response";
import { z } from "zod";
import { parseBody } from "@/lib/body";
import { safe } from "@/lib/http";
import { authDeps, authenticate, clientIp } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Inscription : `{ username, password, code? }` → `201 { user }` + cookie `aqr_session`.
 * Le premier compte de l'atelier est administrateur. `400` (champ fautif dans `field`), `403`
 * (inscriptions fermées / code invalide), `409` (pseudonyme pris), `429` (trop d'essais).
 */
const registerBody = z
  .object({
    username: z.string().max(100),
    password: z.string().max(128),
    code: z.string().max(200).optional(),
  })
  .strict();

async function handlePOST(request: Request) {
  const guard = await authenticate(request, {
    mutation: true,
    anonymous: true,
  });
  if (!guard.ok) return guard.response;
  const body = await parseBody(
    request,
    registerBody,
    "{ username, password, code? }",
  );
  if (!body.ok) return body.response;
  const deps = await authDeps();
  const result = await registerAccount(
    deps,
    body.data,
    clientIp(request, deps.cfg),
  );
  return authResponse(request, deps.cfg, result, 201);
}

export const POST = safe(handlePOST);
