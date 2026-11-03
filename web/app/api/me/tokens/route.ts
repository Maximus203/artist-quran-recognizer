import {
  cleanTokenName,
  createApiToken,
  listApiTokens,
  TokenLimitError,
} from "@/lib/api-tokens";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { parseBody } from "@/lib/body";
import { apiError, json, safe } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

const DEFAULT_TOKEN_DAYS = 180;
const createBody = z
  .object({
    name: z.string(),
    scope: z.enum(["read", "write"]),
    expires_in_days: z.number().min(1).max(365).nullish(),
  })
  .strict();

/** Jetons d'API du compte connecté (jamais leur valeur : seulement nom, préfixe, droits, usage). */
async function handleGET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  return json({ items: listApiTokens(auth.db, auth.user.id) });
}

/**
 * Création : `{ name, scope: "read" | "write", expires_in_days? }` → `201 { token, item }`.
 * La valeur du jeton n'est renvoyée QUE ici, une seule fois. Réservé à la connexion par
 * identifiant : un jeton ne peut pas en créer d'autres.
 */
async function handlePOST(request: Request) {
  const auth = await requireUser(request, { mutation: true });
  if (!auth.ok) return auth.response;
  const body = await parseBody(
    request,
    createBody,
    "{ name, scope, expires_in_days? }",
  );
  if (!body.ok) return body.response;
  const name = cleanTokenName(body.data.name);
  if (name === null)
    return apiError(400, "Le nom fait 1 à 60 caractères.", {
      code: "invalid",
      field: "name",
    });
  // Jamais de jeton sans fin : à défaut de durée, 180 jours (365 au plus, borné par la couche données).
  const days = body.data.expires_in_days ?? DEFAULT_TOKEN_DAYS;
  try {
    const created = createApiToken(auth.db, {
      userId: auth.user.id,
      name,
      scope: body.data.scope,
      expiresInDays: days,
    });
    audit("token.created", {
      userId: auth.user.id,
      reason: `${created.row.scope}, ${days} j`,
    });
    return json({ token: created.token, item: created.row }, 201);
  } catch (error) {
    if (error instanceof TokenLimitError)
      return apiError(409, error.message, { code: "limit" });
    throw error;
  }
}

export const GET = safe(handleGET);
export const POST = safe(handlePOST);
