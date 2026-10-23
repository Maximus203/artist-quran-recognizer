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
 *  - `AQR_PUBLIC_ORIGIN` (ex. `https://lab.example`, avec jeton) : adresse publique d'un tunnel.
 *    Son hôte est accepté comme hôte autorisé, et ses écritures (origine égale à cette adresse)
 *    le sont aussi : derrière un tunnel, Next voit `http://127.0.0.1:<port>`, jamais l'adresse
 *    publique. Valeur mal formée (schéma autre que http(s), chemin, requête) : aucun repli, refus.
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

/** Origine publique (`scheme://hôte[:port]`) de `AQR_PUBLIC_ORIGIN`, ou `null` si absente ou
 *  mal formée (dans ce cas la frontière reste fermée). */
export function parsePublicOrigin(raw: string | undefined): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const plain =
      url.pathname === "/" && !url.search && !url.hash && !url.username;
    if (!plain || (url.protocol !== "https:" && url.protocol !== "http:"))
      return null;
    return url;
  } catch {
    return null;
  }
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

/**
 * Nom d'hôte d'une valeur d'en-tête `Host` / `X-Forwarded-Host`, ou `null` si elle est
 * mal formée ou ambiguë (liste, espaces, identifiants, port non numérique). Le nom reste
 * tel quel (minuscules) : `localhost.` ou `127.0.0.1.evil.example` ne sont jamais acceptés.
 */
export function hostHeaderName(value: string): string | null {
  const match = /^(\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::(\d{1,5}))?$/i.exec(
    value.trim(),
  );
  if (!match || value !== value.trim()) return null;
  return match[1].toLowerCase();
}

/**
 * Le serveur est lié à 127.0.0.1 : l'URL que Next reconstruit porte cet hôte quoi que le client
 * annonce, donc `new URL(request.url).hostname` ne prouve rien (DNS rebinding : une page tierce
 * dont le nom résout vers la boucle locale arrive avec `Host: evil.example`). L'en-tête Host
 * (et X-Forwarded-Host derrière un proxy) est le nom réellement utilisé par le navigateur :
 * il doit lui aussi être un hôte autorisé. Absent (appel interne sans en-tête), seule l'URL compte.
 */
function forwardedHostsAllowed(
  request: Request,
  allowed: (host: string) => boolean,
): boolean {
  for (const name of ["host", "x-forwarded-host"]) {
    const value = request.headers.get(name);
    if (value === null) continue;
    const host = hostHeaderName(value);
    if (host === null || !allowed(host)) return false;
  }
  return true;
}

export function isLocalRequest(
  request: Request,
  mutation = false,
  now = Date.now(),
): boolean {
  const token = process.env.AQR_ACCESS_TOKEN ?? "";
  const publicOrigin = token
    ? parsePublicOrigin(process.env.AQR_PUBLIC_ORIGIN)
    : null;
  const extra = token
    ? [
        ...parseAllowedHosts(process.env.AQR_ALLOWED_HOSTS),
        ...(publicOrigin ? [publicOrigin.hostname] : []),
      ]
    : [];
  const allowed = (host: string) =>
    LOOPBACK.includes(host) || extra.includes(host);
  const url = new URL(request.url);
  if (!allowed(url.hostname)) return false;
  if (!forwardedHostsAllowed(request, allowed)) return false;
  if (token && !tokenAuthorized(request, token, now)) return false;
  const origin = request.headers.get("origin");
  if (!mutation || !origin || origin === url.origin) return true;
  if (publicOrigin && origin === publicOrigin.origin) return true;
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
