import { createHash, randomBytes } from "node:crypto";
import type { Db } from "./db";

/**
 * Invitations de testeurs (couche données + règles). Jeton `inv_<22 caractères>` (128 bits) : non devinable, donc
 * l'empreinte SHA-256 suffit. Le jeton clair n'existe qu'à la création.
 *
 * Deux droits distincts, pour qu'un testeur puisse revenir se connecter :
 *  - l'ACCÈS à l'atelier (la barrière) : valable jusqu'à l'expiration ou la révocation, inscription faite ou non ;
 *  - l'INSCRIPTION : `max_uses` comptes au plus, consommés à la création du compte.
 */
export const INVITATION_PREFIX = "inv_";
export const MAX_ACTIVE_INVITATIONS = 50;
const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;
const MAX_USES = 20;
const TOKEN_RE = /^inv_[A-Za-z0-9_-]{22}$/;

export type InvitationRow = {
  id: number;
  label: string;
  prefix: string;
  created_by: number;
  created_at: string;
  expires_at: string;
  max_uses: number;
  uses: number;
  last_used_at: string | null;
  revoked_at: string | null;
};
export { invitationState, type InvitationState } from "./invitation-state";
import { invitationState, type InvitationState } from "./invitation-state";

export class InvitationLimitError extends Error {
  constructor() {
    super(
      `${MAX_ACTIVE_INVITATIONS} invitations actives au plus : révoque-en une avant d'en créer.`,
    );
    this.name = "InvitationLimitError";
  }
}

const COLUMNS =
  "id, label, prefix, created_by, created_at, expires_at, max_uses, uses, last_used_at, revoked_at";
const hash = (token: string): string =>
  createHash("sha256").update(token).digest("hex");

export const looksLikeInvitation = (value: unknown): value is string =>
  typeof value === "string" && TOKEN_RE.test(value);

export function cleanInvitationLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  return label.length >= 1 && label.length <= 60 ? label : null;
}

const clamp = (
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
) =>
  value === undefined || !Number.isFinite(value)
    ? fallback
    : Math.min(max, Math.max(min, Math.trunc(value)));

export function createInvitation(
  db: Db,
  input: {
    label: string;
    createdBy: number;
    expiresInDays?: number;
    maxUses?: number;
  },
  now = new Date(),
): { token: string; row: InvitationRow } {
  const active = db
    .prepare(
      "SELECT COUNT(*) AS n FROM invitations WHERE revoked_at IS NULL AND expires_at > ?",
    )
    .get(now.toISOString()) as { n: number };
  if (active.n >= MAX_ACTIVE_INVITATIONS) throw new InvitationLimitError();
  const days = clamp(input.expiresInDays, 1, MAX_DAYS, DEFAULT_DAYS);
  const token = INVITATION_PREFIX + randomBytes(16).toString("base64url");
  const info = db
    .prepare(
      `INSERT INTO invitations (label, token_hash, prefix, created_by, created_at, expires_at, max_uses)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.label,
      hash(token),
      token.slice(INVITATION_PREFIX.length, INVITATION_PREFIX.length + 6),
      input.createdBy,
      now.toISOString(),
      new Date(now.getTime() + days * 86_400_000).toISOString(),
      clamp(input.maxUses, 1, MAX_USES, 1),
    );
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM invitations WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as InvitationRow;
  return { token, row };
}

export function listInvitations(db: Db): InvitationRow[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM invitations ORDER BY id DESC`)
    .all() as InvitationRow[];
}

/** Le lien ouvre-t-il l'accès à l'atelier ? Oui tant qu'il n'est ni expiré ni révoqué (même épuisé). */
export function passesGate(db: Db, token: unknown, now = new Date()): boolean {
  if (!looksLikeInvitation(token)) return false;
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM invitations WHERE token_hash = ?`)
    .get(hash(token)) as InvitationRow | undefined;
  if (!row) return false;
  const state = invitationState(row, now);
  if (state === "expired" || state === "revoked") return false;
  db.prepare("UPDATE invitations SET last_used_at = ? WHERE id = ?").run(
    now.toISOString(),
    row.id,
  );
  return true;
}

/**
 * Prend UNE place d'inscription. Atomique (une seule requête conditionnelle) : la dernière place ne se prend
 * qu'une fois, même en rafale. Faux si l'invitation est inconnue, expirée, révoquée ou épuisée.
 */
export function consumeInvitation(
  db: Db,
  token: unknown,
  now = new Date(),
): boolean {
  if (!looksLikeInvitation(token)) return false;
  const info = db
    .prepare(
      `UPDATE invitations SET uses = uses + 1, last_used_at = ?
       WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? AND uses < max_uses`,
    )
    .run(now.toISOString(), hash(token), now.toISOString());
  return Number(info.changes) > 0;
}

/** Reste-t-il une place d'inscription ? Simple lecture : la place n'est prise qu'à la création du compte. */
export function canRegister(db: Db, token: unknown, now = new Date()): boolean {
  if (!looksLikeInvitation(token)) return false;
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM invitations WHERE token_hash = ?`)
    .get(hash(token)) as InvitationRow | undefined;
  return row !== undefined && invitationState(row, now) === "active";
}

/** Révoque une invitation ; faux si elle n'existe pas ou l'est déjà. */
export function revokeInvitation(
  db: Db,
  id: number,
  now = new Date(),
): boolean {
  const info = db
    .prepare(
      "UPDATE invitations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    )
    .run(now.toISOString(), id);
  return Number(info.changes) > 0;
}
