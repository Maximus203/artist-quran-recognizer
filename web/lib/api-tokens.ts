import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db";
import { getUser, type User } from "./users";

/**
 * Jetons d'API et de MCP (couche données + règles). Format `qtr_<43 caractères>` (256 bits) :
 * non devinable, donc l'empreinte SHA-256 suffit (pas de sel). Le jeton clair n'existe qu'à la
 * création ; la base ne garde que l'empreinte.
 */
export const TOKEN_PREFIX = "qtr_";
export type TokenScope = "read" | "write";
export const MAX_TOKENS_PER_USER = 20;
export const MAX_TOKEN_DAYS = 365;
/** `last_used_at` n'est réécrit qu'une fois par minute : pas une écriture par requête. */
const TOUCH_EVERY_MS = 60_000;

export type ApiTokenRow = {
  id: number;
  user_id: number;
  name: string;
  prefix: string;
  scope: TokenScope;
  created_at: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
};

export class TokenLimitError extends Error {
  constructor() {
    super(`Vingt jetons actifs au plus : révoque-en un avant d'en créer.`);
    this.name = "TokenLimitError";
  }
}

export const hashApiToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

/** Vrai pour une valeur qui a la forme d'un jeton (avant toute requête en base). */
export const looksLikeApiToken = (value: string | null | undefined): boolean =>
  typeof value === "string" && /^qtr_[A-Za-z0-9_-]{43}$/.test(value);

/** Le jeton d'un en-tête `Authorization: Bearer …`, ou null s'il n'en a pas la forme. */
export function bearerApiToken(request: Request): string | null {
  const value = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return looksLikeApiToken(value) ? (value as string) : null;
}

export function cleanTokenName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 60 ? name : null;
}

export function createApiToken(
  db: Db,
  input: {
    userId: number;
    name: string;
    scope: TokenScope;
    expiresInDays?: number | null;
  },
  now = new Date(),
): { token: string; row: ApiTokenRow } {
  const active = db
    .prepare(
      `SELECT COUNT(*) AS n FROM api_tokens
       WHERE user_id = ? AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(input.userId, now.toISOString()) as { n: number };
  if (active.n >= MAX_TOKENS_PER_USER) throw new TokenLimitError();
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  const days = input.expiresInDays
    ? Math.min(MAX_TOKEN_DAYS, Math.max(1, Math.floor(input.expiresInDays)))
    : null;
  const expires = days
    ? new Date(now.getTime() + days * 86_400_000).toISOString()
    : null;
  const info = db
    .prepare(
      `INSERT INTO api_tokens (user_id, name, prefix, token_hash, scope, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId,
      input.name,
      token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + 8),
      hashApiToken(token),
      input.scope,
      now.toISOString(),
      expires,
    );
  const row = getTokenRow(db, Number(info.lastInsertRowid)) as ApiTokenRow;
  return { token, row };
}

const COLUMNS =
  "id, user_id, name, prefix, scope, created_at, expires_at, last_used_at, revoked_at";

function getTokenRow(db: Db, id: number): ApiTokenRow | null {
  return (
    (db.prepare(`SELECT ${COLUMNS} FROM api_tokens WHERE id = ?`).get(id) as
      | ApiTokenRow
      | undefined) ?? null
  );
}

export function listApiTokens(db: Db, userId: number): ApiTokenRow[] {
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM api_tokens WHERE user_id = ? ORDER BY id DESC`,
    )
    .all(userId) as ApiTokenRow[];
}

/** Révoque un jeton du compte (jamais celui d'un autre) ; faux s'il n'existe pas ou l'est déjà. */
export function revokeApiToken(
  db: Db,
  userId: number,
  id: number,
  now = new Date(),
): boolean {
  const info = db
    .prepare(
      `UPDATE api_tokens SET revoked_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(now.toISOString(), id, userId);
  return Number(info.changes) > 0;
}

export type ApiIdentity = { user: User; token: ApiTokenRow };

/** L'identité d'un jeton valide (existant, non révoqué, non expiré, compte actif), sinon null. */
export function resolveApiToken(
  db: Db,
  token: string,
  now = Date.now(),
): ApiIdentity | null {
  if (!looksLikeApiToken(token)) return null;
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM api_tokens WHERE token_hash = ?`)
    .get(hashApiToken(token)) as ApiTokenRow | undefined;
  if (!row || row.revoked_at !== null) return null;
  if (row.expires_at !== null && Date.parse(row.expires_at) <= now) return null;
  const user = getUser(db, row.user_id);
  if (!user || user.disabled_at !== null) return null;
  const last = row.last_used_at ? Date.parse(row.last_used_at) : 0;
  if (now - last >= TOUCH_EVERY_MS)
    db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(
      new Date(now).toISOString(),
      row.id,
    );
  return { user, token: row };
}

/** Ce qu'un jeton a le droit de toucher : les essais, rien du compte ni de l'administration. */
const API_PATHS = [/^\/api\/sessions(\/|$)/, /^\/(api\/)?mcp$/, /^\/api\/v1\//];
/** Calculs sans effet sur les données : permis même à un jeton en lecture seule. */
const READ_ONLY_POSTS = [/\/export\/(subtitles|readiness)$/];

export function tokenMayCall(
  scope: TokenScope,
  method: string,
  pathname: string,
): boolean {
  if (!API_PATHS.some((re) => re.test(pathname))) return false;
  // Le MCP parle en POST pour tout (JSON-RPC) : ses outils d'écriture vérifient eux-mêmes le droit.
  if (/^\/(api\/)?mcp$/.test(pathname)) return true;
  if (scope === "write") return true;
  if (method === "POST" && READ_ONLY_POSTS.some((re) => re.test(pathname)))
    return true;
  return method === "GET" || method === "HEAD";
}
