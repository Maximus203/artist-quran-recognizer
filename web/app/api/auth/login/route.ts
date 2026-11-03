import { loginAccount } from "@/lib/auth";
import { authResponse } from "@/lib/auth-response";
import { z } from "zod";
import { parseBody } from "@/lib/body";
import { formTrapped } from "@/lib/form-trap";
import { safe } from "@/lib/http";
import { verifyAgainstDummy } from "@/lib/passwords";
import { authDeps, authenticate, clientIp } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Connexion : `{ username, password }` → `200 { user }` + cookie `aqr_session`.
 * `401` générique (jamais « ce pseudonyme n'existe pas »), `429` avec `Retry-After` après
 * plusieurs échecs (verrouillage progressif par IP + pseudonyme).
 */
const loginBody = z
  .object({
    username: z.string().max(100),
    password: z.string().max(128),
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
  const body = await parseBody(request, loginBody, "{ username, password }");
  if (!body.ok) return body.response;
  const deps = await authDeps();
  const ip = clientIp(request, deps.cfg);
  const { website, _t, ...credentials } = body.data;
  if (formTrapped(deps.db, ip, { website, _t })) {
    // Refus silencieux : même réponse, même coût de calcul qu'un mot de passe faux.
    await verifyAgainstDummy(credentials.password);
    return authResponse(
      request,
      deps.cfg,
      {
        ok: false,
        status: 401,
        message: "Pseudonyme ou mot de passe incorrect.",
      },
      200,
    );
  }
  const result = await loginAccount(deps, credentials, ip);
  return authResponse(request, deps.cfg, result, 200);
}

export const POST = safe(handlePOST);
