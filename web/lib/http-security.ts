/**
 * Règles de sécurité HTTP appliquées par `proxy.ts` avant toute route : en-têtes, CSP, famille de
 * route pour la limitation de débit, taille maximale du corps, requêtes inter-sites. Fonctions
 * pures (testées sans serveur) ; `proxy.ts` ne fait que les brancher.
 */
import { createHash, randomBytes } from "node:crypto";

// ── En-têtes et CSP ───────────────────────────────────────────────────────────────────────────
export const newNonce = (): string => randomBytes(16).toString("base64");

/** Origines `ws:`/`wss:` du service du direct : la page s'y connecte (le jeton vient de l'API). */
export function liveConnectSources(
  raw: string | undefined,
  fallback = "ws://127.0.0.1:8765/live",
): string[] {
  const value = (raw ?? "").trim() || fallback;
  try {
    const url = new URL(value);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") return [];
    return [url.origin];
  } catch {
    return [];
  }
}

export type CspOptions = {
  nonce: string;
  /** `next dev` : le rechargement à chaud exige `unsafe-eval` et un WebSocket local. */
  dev?: boolean;
  /** Origines `ws(s)://…` autorisées pour le direct. */
  connect?: string[];
  /** HTTPS : demande au navigateur de mettre à niveau les ressources `http:`. */
  secure?: boolean;
};

/**
 * Politique stricte : aucun script en ligne sans nonce, aucun `eval` en production, rien chargé hors
 * de l'origine. `style-src` garde `unsafe-inline` : React pose des attributs `style` (le CSP ne sait
 * pas les protéger par un nonce) ; les scripts, eux, restent verrouillés. Pas de `strict-dynamic` :
 * il désactive `'self'`, dont le chargement du worklet audio du direct a besoin.
 */
export function buildCsp({ nonce, dev, connect = [], secure }: CspOptions) {
  const script = ["'self'", `'nonce-${nonce}'`];
  if (dev) script.push("'unsafe-eval'");
  const connectSources = ["'self'", ...connect];
  if (dev) connectSources.push("ws://127.0.0.1:*", "ws://localhost:*");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": script,
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "blob:", "data:"],
    "media-src": ["'self'", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": connectSources,
    "worker-src": ["'self'", "blob:"],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
  };
  const parts = Object.entries(directives).map(
    ([name, values]) => `${name} ${values.join(" ")}`,
  );
  if (secure) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

export type HeaderOptions = CspOptions;

export function securityHeaders(
  options: HeaderOptions,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": buildCsp(options),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin",
    // Le micro n'est autorisé que pour l'atelier lui-même (enregistrement et direct).
    "Permissions-Policy":
      "microphone=(self), camera=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
  };
  // HSTS seulement sur HTTPS : sur HTTP il serait ignoré, et mal compris derrière un proxy.
  if (options.secure)
    headers["Strict-Transport-Security"] =
      "max-age=31536000; includeSubDomains";
  return headers;
}

// ── Familles de routes (limitation de débit) ──────────────────────────────────────────────────
export type Family =
  | "static"
  | "page"
  | "read"
  | "write"
  | "upload"
  | "generate"
  | "mcp"
  | "live"
  | "engine"
  | "auth";

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const isUnsafe = (method: string): boolean =>
  UNSAFE.has(method.toUpperCase());

export function classify(method: string, pathname: string): Family {
  const m = method.toUpperCase();
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico")
    return "static";
  if (pathname === "/mcp" || pathname.startsWith("/api/mcp")) return "mcp";
  if (pathname.startsWith("/api/auth/") || pathname === "/api/access")
    return "auth";
  if (pathname.startsWith("/api/live/")) return "live";
  if (pathname.startsWith("/api/engine/")) return "engine";
  if (!pathname.startsWith("/api/") && !pathname.startsWith("/mcp"))
    return "page";
  if (isUnsafe(m)) {
    if (
      (m === "POST" &&
        /^\/api\/(v1\/recordings|sessions)\/?$/.test(pathname)) ||
      /^\/api\/(v1\/recordings|sessions)\/[^/]+\/(audio|video)$/.test(
        pathname,
      ) ||
      pathname === "/api/me/avatar"
    )
      return "upload";
    if (
      /\/(run|export\/video(\/jobs)?|export\/video\/jobs\/[^/]+)$/.test(
        pathname,
      )
    )
      return "generate";
    return "write";
  }
  return "read";
}

/** Plafonds par minute et par appelant. Valeurs de départ, à ajuster d'après les journaux. */
export const LIMITS: Record<Family, { max: number; windowMs: number }> = {
  static: { max: 2000, windowMs: 60_000 },
  page: { max: 240, windowMs: 60_000 },
  read: { max: 600, windowMs: 60_000 },
  write: { max: 120, windowMs: 60_000 },
  upload: { max: 30, windowMs: 60_000 },
  generate: { max: 30, windowMs: 60_000 },
  mcp: { max: 120, windowMs: 60_000 },
  live: { max: 30, windowMs: 60_000 },
  // Agents du moteur : réclamation (long polling ~25 s), signaux de vie, audio et résultat.
  engine: { max: 240, windowMs: 60_000 },
  auth: { max: 30, windowMs: 60_000 },
};

/**
 * Clé de l'appelant : adresse IP et empreinte du cookie ou du jeton (jamais la valeur elle-même),
 * pour qu'un compte qui s'agite ne bloque pas les autres derrière la même adresse.
 */
export function callerKey(
  headers: Headers,
  ip: string,
): { ip: string; account: string | null } {
  const bearer = /^Bearer\s+(\S+)/i.exec(
    headers.get("authorization") ?? "",
  )?.[1];
  const cookie = /(?:^|;\s*)aqr_session=([^;]+)/.exec(
    headers.get("cookie") ?? "",
  )?.[1];
  const secret = bearer ?? cookie;
  return {
    ip,
    account: secret
      ? createHash("sha256").update(secret).digest("hex").slice(0, 16)
      : null,
  };
}

// ── Taille du corps ───────────────────────────────────────────────────────────────────────────
/** Envois de fichiers : bornés par la route (quota, `AQR_MAX_*`), pas ici. */
export const JSON_BODY_MAX = 1024 * 1024;

/** Plafond de `Content-Length` pour la famille, ou `null` (corps de fichier, borné ailleurs). */
export function bodyLimit(family: Family): number | null {
  // Audio et résultat du moteur : bornés par leur route (MAX_RESULT_BYTES), comme les envois de fichiers.
  return family === "upload" || family === "engine" ? null : JSON_BODY_MAX;
}

export function tooLarge(
  method: string,
  family: Family,
  contentLength: string | null,
): boolean {
  if (!isUnsafe(method)) return false;
  const limit = bodyLimit(family);
  if (limit === null || contentLength === null) return false;
  const length = Number(contentLength);
  return Number.isFinite(length) && length > limit;
}

// ── Requêtes inter-sites ──────────────────────────────────────────────────────────────────────
/**
 * Vrai si un navigateur déclare que la requête vient d'un AUTRE site et qu'elle modifie l'état avec
 * un cookie : c'est la signature d'une attaque CSRF. Sans `Sec-Fetch-Site` (client non navigateur,
 * jeton d'API sans cookie), la règle ne s'applique pas.
 */
export function crossSiteMutation(method: string, headers: Headers): boolean {
  if (!isUnsafe(method)) return false;
  const site = headers.get("sec-fetch-site");
  if (!site || site === "same-origin" || site === "none") return false;
  const hasCookie = /(?:^|;\s*)aqr_session=/.test(headers.get("cookie") ?? "");
  return hasCookie;
}
