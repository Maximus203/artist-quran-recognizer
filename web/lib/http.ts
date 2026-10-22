import { NextResponse } from "next/server";
import { log } from "./log";

/** Réponses JSON d'API : un seul format d'erreur `{ error, code?, field? }` pour toutes les routes. */
export type ApiErrorBody = { error: string; code?: string; field?: string };

export const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string | string[]> = {},
): NextResponse => {
  const response = NextResponse.json(data, { status });
  response.headers.set("Cache-Control", "private, no-store");
  for (const [name, value] of Object.entries(headers))
    for (const item of Array.isArray(value) ? value : [value])
      response.headers.append(name, item);
  return response;
};

export const apiError = (
  status: number,
  error: string,
  extra: {
    code?: string;
    field?: string;
    headers?: Record<string, string>;
  } = {},
): NextResponse => {
  const { headers, ...body } = extra;
  return json({ error, ...body } satisfies ApiErrorBody, status, headers);
};

export const unauthenticated = () =>
  apiError(401, "Connexion requise.", { code: "unauthenticated" });
export const forbidden = (message = "Action non autorisée.") =>
  apiError(403, message, { code: "forbidden" });
export const notFound = (message = "Session introuvable") =>
  apiError(404, message, { code: "not_found" });
export const localOnly = () =>
  apiError(403, "Accès local requis", { code: "local_only" });

/**
 * Enveloppe d'une route : une exception inattendue (base verrouillée, disque plein…) est consignée
 * dans le journal sur UNE ligne lisible (méthode, chemin, message : jamais de jeton ni de corps) et
 * l'appelant reçoit un `500` JSON au format habituel, pas une page HTML.
 */
export function safe<R extends Request, A extends unknown[]>(
  handler: (request: R, ...rest: A) => Promise<Response>,
): (request: R, ...rest: A) => Promise<Response> {
  return async (request, ...rest) => {
    try {
      return await handler(request, ...rest);
    } catch (error) {
      log.error(
        "api",
        `${request.method} ${new URL(request.url).pathname} a échoué`,
        error,
      );
      return apiError(
        500,
        "Erreur interne du serveur : elle est consignée dans le journal.",
        { code: "internal" },
      );
    }
  };
}

/** Corps JSON d'une requête, ou `undefined` s'il est absent ou illisible. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    return text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return undefined;
  }
}
