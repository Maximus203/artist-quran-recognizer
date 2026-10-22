import { NextResponse } from "next/server";

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

/** Corps JSON d'une requête, ou `undefined` s'il est absent ou illisible. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    const text = await request.text();
    return text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return undefined;
  }
}
