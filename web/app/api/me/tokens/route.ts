import {
  cleanTokenName,
  createApiToken,
  listApiTokens,
  TokenLimitError,
  type TokenScope,
} from "@/lib/api-tokens";
import { apiError, json, readJson, safe } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

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
  const body = (await readJson(request)) as
    | { name?: unknown; scope?: unknown; expires_in_days?: unknown }
    | undefined;
  if (!body || typeof body !== "object")
    return apiError(400, "Corps JSON attendu : { name, scope }.");
  const name = cleanTokenName(body.name);
  if (name === null)
    return apiError(400, "Le nom fait 1 à 60 caractères.", {
      code: "invalid",
      field: "name",
    });
  if (body.scope !== "read" && body.scope !== "write")
    return apiError(400, "scope : « read » ou « write ».", {
      code: "invalid",
      field: "scope",
    });
  const days =
    body.expires_in_days === undefined || body.expires_in_days === null
      ? null
      : Number(body.expires_in_days);
  if (days !== null && !(Number.isFinite(days) && days >= 1))
    return apiError(400, "expires_in_days : un nombre de jours, 1 au moins.", {
      code: "invalid",
      field: "expires_in_days",
    });
  try {
    const created = createApiToken(auth.db, {
      userId: auth.user.id,
      name,
      scope: body.scope as TokenScope,
      expiresInDays: days,
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
