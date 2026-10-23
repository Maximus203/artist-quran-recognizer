import type { Db } from "./db";
import { transaction } from "./db";
import { LEGACY_TESTER, TESTER_PATTERN, TESTER_RULE_MESSAGE } from "./tester";

/** Dépôt des comptes (couche données) : SQL paramétré uniquement, aucune règle d'authentification. */
export type Role = "user" | "admin";

export type User = {
  id: number;
  username: string;
  role: Role;
  disabled_at: string | null;
  created_at: string;
  last_login_at: string | null;
  /** Empreinte de la photo de profil (version de cache) ; null = pas de photo. */
  avatar_hash: string | null;
};
export type UserRow = User & { username_key: string; password_hash: string };

/** Forme normalisée du pseudonyme : l'unicité ne dépend ni de la casse ni de la forme Unicode. */
export function usernameKey(username: string): string {
  return username.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export type UsernameCheck =
  | { ok: true; value: string }
  | { ok: false; message: string };

/** Pseudonyme valide : 2–24 caractères, jamais une adresse e-mail, jamais le pseudonyme réservé. */
export function checkUsername(raw: unknown): UsernameCheck {
  if (typeof raw !== "string")
    return { ok: false, message: TESTER_RULE_MESSAGE };
  const value = raw.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!TESTER_PATTERN.test(value))
    return { ok: false, message: TESTER_RULE_MESSAGE };
  if (usernameKey(value) === LEGACY_TESTER)
    return { ok: false, message: "Ce pseudonyme est réservé." };
  return { ok: true, value };
}

export class UsernameTakenError extends Error {
  constructor() {
    super("Ce pseudonyme est déjà pris.");
    this.name = "UsernameTakenError";
  }
}

/** Refus de laisser l'atelier sans administrateur actif. */
export class LastAdminError extends Error {
  constructor() {
    super("Il doit rester au moins un administrateur actif.");
    this.name = "LastAdminError";
  }
}

const COLUMNS =
  "id, username, role, disabled_at, created_at, last_login_at, avatar_hash";

const toUser = (row: Record<string, unknown>): User => ({
  id: row.id as number,
  username: row.username as string,
  role: row.role as Role,
  disabled_at: (row.disabled_at as string | null) ?? null,
  created_at: row.created_at as string,
  last_login_at: (row.last_login_at as string | null) ?? null,
  avatar_hash: (row.avatar_hash as string | null) ?? null,
});

export function countUsers(db: Db): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number })
    .n;
}

/**
 * Crée un compte. Le tout premier compte de l'atelier est administrateur : le rôle est décidé
 * DANS l'instruction d'insertion (un seul ordre SQL, donc atomique) : deux inscriptions
 * simultanées sur une base vide ne donnent jamais deux administrateurs « premiers ».
 */
export function createUser(
  db: Db,
  input: { username: string; passwordHash: string },
  now = new Date().toISOString(),
): User {
  try {
    const result = db
      .prepare(
        `INSERT INTO users (username, username_key, password_hash, role, created_at)
         VALUES (?, ?, ?, CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'admin' ELSE 'user' END, ?)`,
      )
      .run(
        input.username,
        usernameKey(input.username),
        input.passwordHash,
        now,
      );
    return getUser(db, Number(result.lastInsertRowid)) as User;
  } catch (error) {
    if (error instanceof Error && /UNIQUE/i.test(error.message))
      throw new UsernameTakenError();
    throw error;
  }
}

export function getUser(db: Db, id: number): User | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? toUser(row) : null;
}

export function findUserRow(db: Db, username: string): UserRow | null {
  const row = db
    .prepare(
      `SELECT ${COLUMNS}, username_key, password_hash FROM users WHERE username_key = ?`,
    )
    .get(usernameKey(username)) as Record<string, unknown> | undefined;
  return row
    ? {
        ...toUser(row),
        username_key: row.username_key as string,
        password_hash: row.password_hash as string,
      }
    : null;
}

export function getPasswordHash(db: Db, id: number): string | null {
  const row = db
    .prepare("SELECT password_hash FROM users WHERE id = ?")
    .get(id) as { password_hash: string } | undefined;
  return row?.password_hash ?? null;
}

export function setPasswordHash(db: Db, id: number, hash: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
}

export function touchLogin(db: Db, id: number, now: string): void {
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, id);
}

export function listUsers(db: Db): User[] {
  return (
    db.prepare(`SELECT ${COLUMNS} FROM users ORDER BY id`).all() as Record<
      string,
      unknown
    >[]
  ).map(toUser);
}

const activeAdmins = (db: Db): number =>
  (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled_at IS NULL",
      )
      .get() as { n: number }
  ).n;

/**
 * Change le rôle et/ou l'état d'un compte. Désactiver un compte révoque ses connexions. Refuse de
 * retirer le dernier administrateur actif (rôle ou désactivation). `null` si le compte n'existe pas.
 */
export function updateUser(
  db: Db,
  id: number,
  patch: { role?: Role; disabled?: boolean },
  now = new Date().toISOString(),
): User | null {
  return transaction(db, () => {
    const before = getUser(db, id);
    if (!before) return null;
    const role = patch.role ?? before.role;
    const disabledAt =
      patch.disabled === undefined
        ? before.disabled_at
        : patch.disabled
          ? (before.disabled_at ?? now)
          : null;
    const losesAdmin =
      before.role === "admin" &&
      before.disabled_at === null &&
      (role !== "admin" || disabledAt !== null);
    if (losesAdmin && activeAdmins(db) <= 1) throw new LastAdminError();
    db.prepare("UPDATE users SET role = ?, disabled_at = ? WHERE id = ?").run(
      role,
      disabledAt,
      id,
    );
    if (disabledAt !== null)
      db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(id);
    return getUser(db, id);
  });
}
