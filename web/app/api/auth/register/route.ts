import { registerAccount } from "@/lib/auth";
import { authResponse } from "@/lib/auth-response";
import { z } from "zod";
import { parseBody } from "@/lib/body";
import { formTrapped } from "@/lib/form-trap";
import { safe } from "@/lib/http";
import { verifyAgainstDummy } from "@/lib/passwords";
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
    // Champs des formulaires HTML (pièges à robots) ; absents chez un client d'API.
    website: z.string().max(500).optional(),
    _t: z.string().max(60).optional(),
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
  const ip = clientIp(request, deps.cfg);
  const { website, _t, ...registration } = body.data;
  if (formTrapped(deps.db, ip, { website, _t })) {
    // Refus silencieux : même coût de calcul qu'une inscription réelle, aucun indice sur la cause.
    await verifyAgainstDummy(registration.password);
    return authResponse(
      request,
      deps.cfg,
      {
        ok: false,
        status: 400,
        message: "Inscription impossible pour l'instant.",
      },
      201,
    );
  }
  const result = await registerAccount(deps, registration, ip);
  return authResponse(request, deps.cfg, result, 201);
}

export const POST = safe(handlePOST);
