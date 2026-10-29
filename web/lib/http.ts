import { NextResponse } from "next/server";
import { log } from "./log";
import { runWithRequest } from "./request-context";

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
  return (request, ...rest) => {
    // Corrélation : l'identifiant posé par le proxy suit la requête dans TOUTES les lignes de journal.
    const rid = request.headers.get("x-request-id") ?? crypto.randomUUID();
    const started = Date.now();
    const { pathname } = new URL(request.url);
    return runWithRequest(rid, async () => {
      let response: Response;
      try {
        response = await handler(request, ...rest);
      } catch (error) {
        log.error("api", `${request.method} ${pathname} a échoué`, error);
        response = apiError(
          500,
          "Erreur interne du serveur : elle est consignée dans le journal.",
          { code: "internal" },
        );
      }
      // Accès : méthode, chemin SANS requête (elle peut contenir une recherche), statut, durée.
      const status = response.status;
      log.event(
        "access",
        `${request.method} ${pathname}`,
        { status, ms: Date.now() - started },
        status >= 500 ? "error" : status >= 400 ? "warn" : "info",
      );
      return response;
    });
  };
}

/** Plafond de lecture d'un corps JSON (aligné sur `JSON_BODY_MAX` du proxy). */
const JSON_LIMIT = 1024 * 1024;

/**
 * Corps JSON d'une requête, ou `undefined` s'il est absent, illisible ou trop gros. La lecture est
 * bornée : au-delà de `limit` octets on arrête, sans jamais garder un corps énorme en mémoire.
 */
export async function readJson(
  request: Request,
  limit = JSON_LIMIT,
): Promise<unknown> {
  try {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) return undefined;
    const reader = request.body?.getReader();
    if (!reader) return {};
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        return undefined;
      }
      chunks.push(value);
    }
    const text = Buffer.concat(chunks).toString("utf8");
    return text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return undefined;
  }
}
