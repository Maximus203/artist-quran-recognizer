import {
  boundHostname,
  isLocalRequest,
  parseAllowedHosts,
} from "./local-request";
import {
  bearerApiToken,
  resolveApiToken,
  tokenMayCall,
  type ApiTokenRow,
} from "./api-tokens";
import {
  authConfig,
  createLimiters,
  resolveLogin,
  sessionToken,
  type AuthConfig,
  type AuthDeps,
  type Limiters,
} from "./auth";
import type { Db } from "./db";
import { forbidden, localOnly, notFound, unauthenticated } from "./http";
import { decide, type Ability } from "./access";
import { getMeta, type MetaRow } from "./session-index";
import { syncSession } from "./session-sync";
import { isSessionId } from "./session-id";
import { readSession } from "./store";
import { ready } from "./server-init";
import type { User } from "./users";
import {
  authenticateAgent,
  bearerAgentToken,
  type AgentRow,
} from "./engine-agents";

/**
 * Garde commune des routes d'API. Deux couches, dans cet ordre :
 *  1. réseau : `isLocalRequest` (hôte, origine, jeton d'accès du mode distant) → 403 ;
 *  2. identité : cookie `aqr_session` → utilisateur, sinon 401 JSON (jamais une redirection :
 *     c'est à l'interface de rediriger vers /login).
 * Puis, pour une route de session, l'autorisation de `access.ts` (404 si invisible, 403 si
 * visible mais non modifiable).
 */
export type Authenticated = {
  ok: true;
  db: Db;
  user: User | null;
  token: string | null;
  cfg: AuthConfig;
  /** Renseigné quand la requête s'identifie par un jeton d'API (et non par la connexion). */
  api?: ApiTokenRow;
};
export type Denied = { ok: false; response: Response };

const LIMITERS = Symbol.for("aqr.auth-limiters");
/** Limiteurs d'authentification : un jeu par processus (le serveur est unique). */
export function limiters(cfg = authConfig(), db?: Db): Limiters {
  const holder = globalThis as { [LIMITERS]?: Limiters };
  return (holder[LIMITERS] ??= createLimiters(cfg, db));
}

export async function authDeps(): Promise<AuthDeps> {
  const cfg = authConfig();
  const db = await ready();
  return { db, cfg, limiters: limiters(cfg, db) };
}

/** IP du client : seulement `X-Forwarded-For` (dernier saut) derrière un proxy de confiance. */
export function clientIp(request: Request, cfg: AuthConfig): string {
  if (!cfg.trustProxy) return "local";
  const forwarded = request.headers.get("x-forwarded-for");
  const last = forwarded?.split(",").pop()?.trim();
  return last && /^[0-9a-f:.]{3,45}$/i.test(last) ? last : "unknown";
}

export function isSecure(request: Request, cfg: AuthConfig): boolean {
  if (new URL(request.url).protocol === "https:") return true;
  return (
    cfg.trustProxy &&
    request.headers.get("x-forwarded-proto")?.split(",").pop()?.trim() ===
      "https"
  );
}

/**
 * Couche réseau + identité. `anonymous` : la route est publique (inscription, connexion,
 * configuration) ; sans lui, une requête sans connexion valide reçoit 401.
 */
export async function authenticate(
  request: Request,
  {
    mutation = false,
    anonymous = false,
  }: { mutation?: boolean; anonymous?: boolean } = {},
): Promise<Authenticated | Denied> {
  const apiToken = bearerApiToken(request);
  if (apiToken) return authenticateApiToken(request, apiToken);
  if (!isLocalRequest(request, mutation))
    return { ok: false, response: localOnly() };
  const db = await ready();
  const cfg = authConfig();
  const token = sessionToken(request.headers.get("cookie"));
  const user = token ? resolveLogin(db, token, cfg) : null;
  if (!user && !anonymous) return { ok: false, response: unauthenticated() };
  return { ok: true, db, user, token, cfg };
}

/**
 * Entrée API/MCP : un jeton `qtr_…` en `Authorization: Bearer`. Il tient lieu de jeton d'accès
 * du tunnel (il est lui-même un secret), mais l'hôte doit rester un hôte autorisé ; pas de
 * cookie donc pas de contrôle d'origine (rien à falsifier depuis un navigateur). Un jeton ne
 * touche que les essais (`tokenMayCall`) et une clé en lecture ne peut pas écrire.
 */
async function authenticateApiToken(
  request: Request,
  apiToken: string,
): Promise<Authenticated | Denied> {
  const url = new URL(request.url);
  if (!apiHostAllowed(request)) return { ok: false, response: localOnly() };
  const db = await ready();
  const identity = resolveApiToken(db, apiToken);
  if (!identity) return { ok: false, response: unauthenticated() };
  if (!tokenMayCall(identity.token.scope, request.method, url.pathname))
    return {
      ok: false,
      response: forbidden(
        identity.token.scope === "read"
          ? "Ce jeton est en lecture seule."
          : "Un jeton d'API ne peut pas faire cela.",
      ),
    };
  return {
    ok: true,
    db,
    user: identity.user,
    token: null,
    cfg: authConfig(),
    api: identity.token,
  };
}

/** Hôtes acceptés pour l'API : boucle locale, plus les hôtes déclarés du mode distant. */
function apiHostAllowed(request: Request): boolean {
  const extra = process.env.AQR_ACCESS_TOKEN
    ? parseAllowedHosts(process.env.AQR_ALLOWED_HOSTS)
    : [];
  const publicHost = process.env.AQR_ACCESS_TOKEN
    ? safeHostname(process.env.AQR_PUBLIC_ORIGIN)
    : null;
  const allowed = new Set([
    "127.0.0.1",
    "localhost",
    "[::1]",
    ...extra,
    ...(publicHost ? [publicHost] : []),
  ]);
  for (const name of ["host", "x-forwarded-host"]) {
    const value = request.headers.get(name);
    if (value === null) continue;
    const host = value.trim().toLowerCase().replace(/:\d+$/, "");
    if (!allowed.has(host)) return false;
  }
  const bound = new URL(request.url).hostname;
  return allowed.has(bound) || bound === boundHostname();
}

function safeHostname(raw: string | undefined): string | null {
  try {
    return raw ? new URL(raw).hostname : null;
  } catch {
    return null;
  }
}

export type AgentAuth = { ok: true; db: Db; agent: AgentRow } | Denied;

/**
 * Entrée des routes `/api/engine/*` : un jeton d'AGENT (`qea_…`) en `Authorization: Bearer`, rien d'autre.
 * Ni cookie de connexion ni jeton d'utilisateur ne passent ici, et un jeton d'agent n'ouvre aucune autre
 * route (`authenticate` ne reconnaît que `qtr_…`). L'hôte doit rester un hôte autorisé.
 */
export async function requireAgent(request: Request): Promise<AgentAuth> {
  if (!apiHostAllowed(request)) return { ok: false, response: localOnly() };
  const db = await ready();
  const agent = authenticateAgent(db, bearerAgentToken(request));
  if (!agent) return { ok: false, response: unauthenticated() };
  return { ok: true, db, agent };
}

export type SignedIn = Authenticated & { user: User; token: string };

/** Comme `authenticate`, avec un utilisateur garanti. */
export async function requireUser(
  request: Request,
  options: { mutation?: boolean } = {},
): Promise<SignedIn | Denied> {
  const auth = await authenticate(request, options);
  if (!auth.ok) return auth;
  return auth as SignedIn;
}

/** Utilisateur de la requête, ou null (aucune réponse d'erreur construite). */
export async function currentUser(request: Request): Promise<User | null> {
  const auth = await authenticate(request, { anonymous: true });
  return auth.ok ? auth.user : null;
}

export async function requireAdmin(
  request: Request,
  options: { mutation?: boolean } = {},
): Promise<SignedIn | Denied> {
  const auth = await requireUser(request, options);
  if (!auth.ok) return auth;
  if (auth.user.role !== "admin")
    return { ok: false, response: forbidden("Réservé aux administrateurs.") };
  return auth;
}

/**
 * Métadonnées d'une session. Une session présente sur le disque mais absente de l'index (créée hors
 * de l'atelier) y entre ici, comme session d'avant les comptes : globale, sans propriétaire.
 */
export async function metaFor(db: Db, id: string): Promise<MetaRow | null> {
  if (!isSessionId(id)) return null;
  const known = getMeta(db, id);
  if (known) return known;
  try {
    await syncSession(await readSession(id));
  } catch {
    return null;
  }
  return getMeta(db, id);
}

export type SessionAccess = SignedIn & { id: string; meta: MetaRow };

/** Connexion + droit sur UNE session : 404 si invisible ou inconnue, 403 si visible mais interdite. */
export async function sessionAccess(
  request: Request,
  params: Promise<{ id: string }>,
  ability: Ability,
  options: { mutation?: boolean } = {},
): Promise<SessionAccess | Denied> {
  const auth = await requireUser(request, options);
  if (!auth.ok) return auth;
  const { id } = await params;
  const meta = await metaFor(auth.db, id);
  const verdict = decide(auth.user, ability, meta);
  if (verdict === "absent" || !meta) return { ok: false, response: notFound() };
  if (verdict === "forbidden")
    return {
      ok: false,
      response: forbidden(
        ability === "truth"
          ? "La vérité terrain est réservée aux administrateurs."
          : "Seul le propriétaire (ou un administrateur) peut faire cela.",
      ),
    };
  return { ...auth, id, meta };
}
