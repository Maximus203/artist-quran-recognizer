import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Frontière d'accès de l'atelier.
 *
 * Par défaut : boucle locale uniquement (comportement historique). Le mode
 * « test distant » est opt-in et fail-closed :
 *  - `AQR_ALLOWED_HOSTS` (liste séparée par des virgules, vide par défaut) ajoute
 *    des noms d'hôte ; un hôte ajouté n'est accepté que si `AQR_ACCESS_TOKEN` est défini ;
 *  - `AQR_ACCESS_TOKEN` : dès qu'il est défini, toute requête (même loopback) doit
 *    le présenter (en-tête `x-aqr-token`, `Authorization: Bearer`, ou cookie d'accès) ;
 *  - `AQR_ACCESS_TTL_S` : durée de vie (secondes) du cookie délivré par `/api/access`.
 */
export const ACCESS_COOKIE = "aqr_access";
export const TOKEN_HEADER = "x-aqr-token";
const DEFAULT_TTL_S = 3600;
const MAX_TTL_S = 7 * 24 * 3600;
const LOOPBACK = ["127.0.0.1", "localhost", "[::1]"];

export function parseAllowedHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter(Boolean);
}

export function accessTtlSeconds(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value <= MAX_TTL_S
    ? value
    : DEFAULT_TTL_S;
}

/** Comparaison à temps constant (HMAC des deux côtés : longueurs égalisées). */
export function verifyToken(
  candidate: string | null | undefined,
  expected: string,
): boolean {
  if (!candidate || !expected) return false;
  const key = "aqr-token-compare";
  const a = createHmac("sha256", key).update(candidate).digest();
  const b = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(a, b);
}

function sign(token: string, expires: string): string {
  return createHmac("sha256", token)
    .update(`aqr-access:${expires}`)
    .digest("hex");
}

/** Cookie sans état `<expiration_ms>.<hmac>`, lié au jeton configuré. */
export function issueAccessCookie(
  token: string,
  ttlSeconds: number,
  now = Date.now(),
): string {
  const expires = String(now + ttlSeconds * 1000);
  return `${expires}.${sign(token, expires)}`;
}

function cookieValid(
  value: string | undefined,
  token: string,
  now: number,
): boolean {
  if (!value) return false;
  const parts = value.split(".");
  if (parts.length !== 2 || !/^\d{1,16}$/.test(parts[0])) return false;
  if (Number(parts[0]) <= now) return false;
  return verifyToken(parts[1], sign(token, parts[0]));
}

function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name)
      return part.slice(index + 1).trim();
  }
  return undefined;
}

function tokenAuthorized(request: Request, token: string, now: number) {
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1];
  return (
    verifyToken(request.headers.get(TOKEN_HEADER), token) ||
    verifyToken(bearer, token) ||
    cookieValid(readCookie(request, ACCESS_COOKIE), token, now)
  );
}

/** Vrai si aucun jeton n'est requis, ou si la requête en présente un valide. */
export function hasAccessCredential(
  request: Request,
  now = Date.now(),
): boolean {
  const token = process.env.AQR_ACCESS_TOKEN ?? "";
  return !token || tokenAuthorized(request, token, now);
}

export function isLocalRequest(
  request: Request,
  mutation = false,
  now = Date.now(),
): boolean {
  const token = process.env.AQR_ACCESS_TOKEN ?? "";
  const extra = token ? parseAllowedHosts(process.env.AQR_ALLOWED_HOSTS) : [];
  const allowed = (host: string) =>
    LOOPBACK.includes(host) || extra.includes(host);
  const url = new URL(request.url);
  if (!allowed(url.hostname)) return false;
  if (token && !tokenAuthorized(request, token, now)) return false;
  const origin = request.headers.get("origin");
  if (!mutation || !origin || origin === url.origin) return true;
  try {
    const source = new URL(origin);
    return (
      origin === source.origin &&
      allowed(source.hostname) &&
      source.protocol === url.protocol &&
      source.port === url.port
    );
  } catch {
    return false;
  }
}
