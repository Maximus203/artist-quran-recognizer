/**
 * Client de l'API de l'atelier (navigateur). UN seul endroit décide de la forme des erreurs et de
 * la réaction à une connexion expirée : `401 { code: "unauthenticated" }` renvoie vers `/login`
 * (en gardant la page demandée) ; tout autre échec devient une `ApiError` au message lisible, que
 * l'interface peut afficher telle quelle.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const PUBLIC_PATHS = ["/login", "/register"];

/** Adresse de connexion qui ramène à la page courante ; jamais depuis la connexion elle-même. */
export function loginUrl(pathname: string, search: string): string {
  if (PUBLIC_PATHS.includes(pathname)) return "/login";
  return `/login?next=${encodeURIComponent(pathname + search)}`;
}

type Init = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit };

const NETWORK_MESSAGE =
  "Connexion au serveur impossible : vérifie le réseau puis réessaie.";
const SERVER_MESSAGE = "Le serveur a répondu par une erreur inattendue.";

export async function api<T = unknown>(
  url: string,
  init: Init = {},
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  let body = rest.body;
  if (json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(json);
  }
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...rest, headers, body });
  } catch {
    throw new ApiError(NETWORK_MESSAGE, 0);
  }
  if (response.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    /* corps absent ou illisible */
  }
  if (!response.ok) {
    const record = (
      typeof data === "object" && data !== null ? data : {}
    ) as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code : undefined;
    if (response.status === 401 && code === "unauthenticated")
      location.assign(
        loginUrl(location.pathname, location.search),
      );
    throw new ApiError(
      typeof record.error === "string" ? record.error : SERVER_MESSAGE,
      response.status,
      code,
      typeof record.field === "string" ? record.field : undefined,
    );
  }
  return data as T;
}
