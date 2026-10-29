import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db";

/**
 * Agents du moteur d'analyse à distance (ADR-0017). Jeton `qea_<43 caractères>` (256 bits) : non devinable,
 * donc l'empreinte SHA-256 suffit. Le jeton clair n'existe qu'à la création. Il est distinct des jetons
 * d'utilisateurs (`qtr_`) : l'un n'ouvre jamais les routes de l'autre.
 */
export const AGENT_PREFIX = "qea_";
export const MAX_ACTIVE_AGENTS = 5;
/** `last_seen_at` n'est réécrit qu'une fois par 15 s : un signal de vie n'est pas une écriture par requête. */
const TOUCH_EVERY_MS = 15_000;

export type AgentRow = {
  id: number;
  name: string;
  prefix: string;
  created_by: number;
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};

export class AgentLimitError extends Error {
  constructor() {
    super(
      `${MAX_ACTIVE_AGENTS} agents actifs au plus : révoque-en un avant d'en créer.`,
    );
    this.name = "AgentLimitError";
  }
}

export const hashAgentToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const looksLikeAgentToken = (
  value: string | null | undefined,
): boolean =>
  typeof value === "string" && /^qea_[A-Za-z0-9_-]{43}$/.test(value);

/** Le jeton d'un en-tête `Authorization: Bearer …`, ou null s'il n'a pas la forme d'un jeton d'agent. */
export function bearerAgentToken(request: Request): string | null {
  const value = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  return looksLikeAgentToken(value) ? (value as string) : null;
}

const COLUMNS =
  "id, name, prefix, created_by, created_at, last_seen_at, revoked_at";

export function cleanAgentName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= 60 ? name : null;
}

export function createAgent(
  db: Db,
  input: { name: string; createdBy: number },
  now = new Date(),
): { token: string; row: AgentRow } {
  const active = db
    .prepare("SELECT COUNT(*) AS n FROM engine_agents WHERE revoked_at IS NULL")
    .get() as { n: number };
  if (active.n >= MAX_ACTIVE_AGENTS) throw new AgentLimitError();
  const token = AGENT_PREFIX + randomBytes(32).toString("base64url");
  const info = db
    .prepare(
      `INSERT INTO engine_agents (name, token_hash, prefix, created_by, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.name,
      hashAgentToken(token),
      token.slice(AGENT_PREFIX.length, AGENT_PREFIX.length + 8),
      input.createdBy,
      now.toISOString(),
    );
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM engine_agents WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as AgentRow;
  return { token, row };
}

export function listAgents(db: Db): AgentRow[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM engine_agents ORDER BY id DESC`)
    .all() as AgentRow[];
}

/** Révoque un agent ; faux s'il n'existe pas ou l'est déjà. */
export function revokeAgent(db: Db, id: number, now = new Date()): boolean {
  const info = db
    .prepare(
      "UPDATE engine_agents SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    )
    .run(now.toISOString(), id);
  return Number(info.changes) > 0;
}

/** L'agent qui présente ce jeton, ou null (jeton inconnu, mal formé ou révoqué). */
export function authenticateAgent(
  db: Db,
  token: string | null,
  now = new Date(),
): AgentRow | null {
  if (!looksLikeAgentToken(token)) return null;
  const row = db
    .prepare(
      `SELECT ${COLUMNS} FROM engine_agents WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .get(hashAgentToken(token as string)) as AgentRow | undefined;
  if (!row) return null;
  const last = row.last_seen_at ? Date.parse(row.last_seen_at) : 0;
  if (now.getTime() - last >= TOUCH_EVERY_MS) {
    db.prepare("UPDATE engine_agents SET last_seen_at = ? WHERE id = ?").run(
      now.toISOString(),
      row.id,
    );
    row.last_seen_at = now.toISOString();
  }
  return row;
}

/** Vrai si un agent a donné signe de vie depuis moins de `withinMs` (moteur « en ligne »). */
export function engineOnline(
  db: Db,
  withinMs = 120_000,
  now = Date.now(),
): boolean {
  const row = db
    .prepare(
      "SELECT MAX(last_seen_at) AS seen FROM engine_agents WHERE revoked_at IS NULL",
    )
    .get() as { seen: string | null };
  return row.seen !== null && now - Date.parse(row.seen) < withinMs;
}
