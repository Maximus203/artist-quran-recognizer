import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import type { Db } from "./db";
import { transaction } from "./db";
import { FailureLimiter, HitLimiter, type Verdict } from "./rate-limit";
import {
  hashPassword,
  needsRehash,
  verifyAgainstDummy,
  verifyPassword,
} from "./passwords";
import {
  UsernameTakenError,
  checkUsername,
  countUsers,
  createUser,
  findUserRow,
  getUser,
  setPasswordHash,
  touchLogin,
  usernameKey,
  type User,
} from "./users";

/**
 * Authentification par pseudonyme + mot de passe, sessions de connexion en base.
 * Ce module est pur vis-à-vis de HTTP : il reçoit la base, l'horloge, la configuration et les
 * limiteurs (`AuthDeps`) ; `lib/route-guard.ts` fait le lien avec les requêtes.
 */
export const SESSION_COOKIE = "aqr_session";
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export type SignupMode = "open" | "closed" | "code";

export type AuthConfig = {
  /** Durée glissante d'une connexion, en secondes (`AQR_LOGIN_TTL_DAYS`, 30 j). */
  ttlS: number;
  /** Durée de vie absolue : une connexion ne glisse jamais au-delà (`AQR_LOGIN_MAX_DAYS`, 180 j). */
  maxS: number;
  signup: SignupMode;
  signupCode: string;
  /** Derrière un proxy de confiance : IP et protocole viennent de `X-Forwarded-*`. */
  trustProxy: boolean;
  registerPerHour: number;
};

const DAY = 86_400;
const positiveInt = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
};

export function authConfig(
  env: Record<string, string | undefined> = process.env,
): AuthConfig {
  const ttlS = positiveInt(env.AQR_LOGIN_TTL_DAYS, 30) * DAY;
  const mode = (env.AQR_SIGNUP ?? "open").trim().toLowerCase();
  return {
    ttlS,
    maxS: Math.max(ttlS, positiveInt(env.AQR_LOGIN_MAX_DAYS, 180) * DAY),
    // Valeur inconnue : fermé (fail-closed), jamais ouvert par une faute de frappe.
    signup: mode === "open" || mode === "code" ? mode : "closed",
    signupCode: env.AQR_SIGNUP_CODE ?? "",
    trustProxy: env.AQR_TRUST_PROXY === "1",
    registerPerHour: positiveInt(env.AQR_REGISTER_PER_HOUR, 10),
  };
}

// ── Jetons et cookie ──────────────────────────────────────────────────────────────────────────
/** 256 bits aléatoires, base64url (43 caractères). */
export const newToken = (): string => randomBytes(32).toString("base64url");
/** Seule la forme hachée est stockée : un jeton aléatoire de 256 bits n'a pas besoin d'un hachage lent. */
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

export function readCookie(
  header: string | null | undefined,
  name: string,
): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name)
      return part.slice(index + 1).trim();
  }
  return undefined;
}

export const sessionToken = (cookieHeader: string | null): string | null => {
  const value = readCookie(cookieHeader, SESSION_COOKIE);
  return value && TOKEN_SHAPE.test(value) ? value : null;
};

/** `Set-Cookie` de connexion : HttpOnly, SameSite=Lax, Secure si la connexion est en HTTPS. */
export function loginCookie(
  token: string,
  maxAgeS: number,
  secure: boolean,
): string {
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
export const clearedCookie = (secure: boolean): string =>
  `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

// ── Connexions en base ────────────────────────────────────────────────────────────────────────
const iso = (ms: number) => new Date(ms).toISOString();
/** Au plus une écriture de « dernière activité » par tranche de 10 minutes et par connexion. */
const SLIDE_STEP_MS = 10 * 60 * 1000;

export function createLogin(
  db: Db,
  userId: number,
  cfg: AuthConfig,
  now = Date.now(),
): string {
  const token = newToken();
  db.prepare(
    `INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    hashToken(token),
    userId,
    iso(now),
    iso(now),
    iso(now + cfg.ttlS * 1000),
  );
  // Ménage opportuniste : les connexions expirées ne s'accumulent pas.
  db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(iso(now));
  return token;
}

/** L'utilisateur d'un jeton valide (non expiré, compte actif), ou null. Fait glisser l'expiration. */
export function resolveLogin(
  db: Db,
  token: string,
  cfg: AuthConfig,
  now = Date.now(),
): User | null {
  const row = db
    .prepare(
      `SELECT a.id AS auth_id, a.user_id, a.created_at, a.expires_at, u.disabled_at
       FROM auth_sessions a JOIN users u ON u.id = a.user_id
       WHERE a.token_hash = ?`,
    )
    .get(hashToken(token)) as
    | {
        auth_id: number;
        user_id: number;
        created_at: string;
        expires_at: string;
        disabled_at: string | null;
      }
    | undefined;
  if (!row || row.disabled_at !== null) return null;
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= now) {
    db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(row.auth_id);
    return null;
  }
  const ceiling = Date.parse(row.created_at) + cfg.maxS * 1000;
  const next = Math.min(now + cfg.ttlS * 1000, ceiling);
  if (next - expires >= SLIDE_STEP_MS)
    db.prepare(
      "UPDATE auth_sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?",
    ).run(iso(next), iso(now), row.auth_id);
  return getUser(db, row.user_id);
}

export function revokeLogin(db: Db, token: string): void {
  db.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(
    hashToken(token),
  );
}

/** Révoque toutes les connexions d'un compte, sauf éventuellement celle qu'on garde. */
export function revokeAllLogins(
  db: Db,
  userId: number,
  exceptToken?: string,
): void {
  if (exceptToken)
    db.prepare(
      "DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?",
    ).run(userId, hashToken(exceptToken));
  else db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(userId);
}

// ── Service d'inscription et de connexion ─────────────────────────────────────────────────────
export type Limiters = {
  /** Échecs de connexion par (IP + pseudonyme). */
  loginUser: FailureLimiter;
  /** Échecs de connexion par IP, tous pseudonymes confondus (balayage de pseudonymes). */
  loginIp: FailureLimiter;
  register: HitLimiter;
};

export function createLimiters(cfg: AuthConfig): Limiters {
  const window = 30 * 60 * 1000;
  return {
    loginUser: new FailureLimiter({
      threshold: 5,
      baseLockMs: 15_000,
      maxLockMs: 15 * 60 * 1000,
      windowMs: window,
    }),
    loginIp: new FailureLimiter({
      threshold: 25,
      baseLockMs: 15_000,
      maxLockMs: 15 * 60 * 1000,
      windowMs: window,
    }),
    register: new HitLimiter(cfg.registerPerHour, 60 * 60 * 1000),
  };
}

export type AuthDeps = {
  db: Db;
  cfg: AuthConfig;
  limiters: Limiters;
  now?: () => number;
};

export type AuthFailure = {
  ok: false;
  status: 400 | 401 | 403 | 409 | 429;
  message: string;
  field?: "username" | "password" | "code";
  retryAfterS?: number;
};
export type AuthSuccess = { ok: true; user: User; token: string };
export type AuthResult = AuthSuccess | AuthFailure;

const tooMany = (
  verdict: Extract<Verdict, { allowed: false }>,
): AuthFailure => ({
  ok: false,
  status: 429,
  message: `Trop d'essais : réessaie dans ${verdict.retryAfterS < 60 ? `${verdict.retryAfterS} s` : `${Math.ceil(verdict.retryAfterS / 60)} min`}.`,
  retryAfterS: verdict.retryAfterS,
});

const passwordSchema = z
  .string()
  .min(
    PASSWORD_MIN,
    `Le mot de passe fait au moins ${PASSWORD_MIN} caractères.`,
  )
  .max(
    PASSWORD_MAX,
    `Le mot de passe fait au plus ${PASSWORD_MAX} caractères.`,
  );

/** Comparaison à temps constant (HMAC des deux côtés : longueurs égalisées). */
function sameSecret(candidate: string, expected: string): boolean {
  const key = "aqr-signup-code";
  const a = createHmac("sha256", key).update(candidate).digest();
  const b = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(a, b);
}

export type Registration = {
  username: unknown;
  password: unknown;
  code?: unknown;
};

/** Mode d'inscription effectif : l'amorçage (aucun compte) reste possible quand l'atelier est « fermé ». */
export function signupStatus(deps: Pick<AuthDeps, "db" | "cfg">): {
  signup: SignupMode;
  setup_required: boolean;
} {
  return {
    signup: deps.cfg.signup,
    setup_required: countUsers(deps.db) === 0,
  };
}

export async function registerAccount(
  deps: AuthDeps,
  input: Registration,
  ip: string,
): Promise<AuthResult> {
  const now = deps.now?.() ?? Date.now();
  const limit = deps.limiters.register.hit(`register:${ip}`, now);
  if (!limit.allowed) return tooMany(limit);

  const { signup, signupCode } = deps.cfg;
  const bootstrap = countUsers(deps.db) === 0;
  if (signup === "closed" && !bootstrap)
    return {
      ok: false,
      status: 403,
      message: "Les inscriptions sont fermées.",
    };
  if (signup === "code") {
    // Un code non configuré ferme l'inscription (fail-closed) : jamais « code vide accepté ».
    const given = typeof input.code === "string" ? input.code : "";
    if (!signupCode || !sameSecret(given, signupCode))
      return {
        ok: false,
        status: 403,
        message: "Code d'invitation invalide.",
        field: "code",
      };
  }

  const name = checkUsername(input.username);
  if (!name.ok)
    return { ok: false, status: 400, message: name.message, field: "username" };
  const password = passwordSchema.safeParse(input.password);
  if (!password.success)
    return {
      ok: false,
      status: 400,
      message: password.error.issues[0].message,
      field: "password",
    };
  if (usernameKey(password.data) === usernameKey(name.value))
    return {
      ok: false,
      status: 400,
      message: "Le mot de passe ne peut pas être le pseudonyme.",
      field: "password",
    };

  const passwordHash = await hashPassword(password.data);
  try {
    const user = transaction(deps.db, () => {
      const created = createUser(
        deps.db,
        { username: name.value, passwordHash },
        iso(now),
      );
      touchLogin(deps.db, created.id, iso(now));
      return created;
    });
    return {
      ok: true,
      user: getUser(deps.db, user.id) as User,
      token: createLogin(deps.db, user.id, deps.cfg, now),
    };
  } catch (error) {
    if (error instanceof UsernameTakenError)
      return {
        ok: false,
        status: 409,
        message: error.message,
        field: "username",
      };
    throw error;
  }
}

const GENERIC_LOGIN_ERROR = "Pseudonyme ou mot de passe incorrect.";

export async function loginAccount(
  deps: AuthDeps,
  input: { username: unknown; password: unknown },
  ip: string,
): Promise<AuthResult> {
  const now = deps.now?.() ?? Date.now();
  const bad: AuthFailure = {
    ok: false,
    status: 401,
    message: GENERIC_LOGIN_ERROR,
  };
  if (
    typeof input.username !== "string" ||
    typeof input.password !== "string" ||
    input.username.length > 100 ||
    input.password.length > PASSWORD_MAX
  )
    return bad;
  const userKey = `login:${ip}:${usernameKey(input.username)}`;
  const ipKey = `login-ip:${ip}`;
  for (const [limiter, key] of [
    [deps.limiters.loginUser, userKey],
    [deps.limiters.loginIp, ipKey],
  ] as const) {
    const verdict = limiter.check(key, now);
    if (!verdict.allowed) return tooMany(verdict);
  }

  const row = findUserRow(deps.db, input.username);
  const valid =
    row && row.disabled_at === null
      ? await verifyPassword(input.password, row.password_hash)
      : await verifyAgainstDummy(input.password);
  if (!row || !valid) {
    deps.limiters.loginUser.fail(userKey, now);
    deps.limiters.loginIp.fail(ipKey, now);
    return bad;
  }
  deps.limiters.loginUser.succeed(userKey);
  if (needsRehash(row.password_hash))
    setPasswordHash(deps.db, row.id, await hashPassword(input.password));
  touchLogin(deps.db, row.id, iso(now));
  return {
    ok: true,
    user: getUser(deps.db, row.id) as User,
    token: createLogin(deps.db, row.id, deps.cfg, now),
  };
}

/** Changement de mot de passe : exige l'ancien ; les autres connexions du compte sont révoquées. */
export async function changePassword(
  deps: AuthDeps,
  user: User,
  currentToken: string | null,
  input: { current: unknown; next: unknown },
  ip: string,
): Promise<{ ok: true } | AuthFailure> {
  const now = deps.now?.() ?? Date.now();
  const key = `login:${ip}:${usernameKey(user.username)}`;
  const verdict = deps.limiters.loginUser.check(key, now);
  if (!verdict.allowed) return tooMany(verdict);
  const row = findUserRow(deps.db, user.username);
  const matches =
    typeof input.current === "string" &&
    row !== null &&
    (await verifyPassword(input.current, row.password_hash));
  if (!matches) {
    deps.limiters.loginUser.fail(key, now);
    return {
      ok: false,
      status: 401,
      message: "Le mot de passe actuel est incorrect.",
      field: "password",
    };
  }
  deps.limiters.loginUser.succeed(key);
  const next = passwordSchema.safeParse(input.next);
  if (!next.success)
    return {
      ok: false,
      status: 400,
      message: next.error.issues[0].message,
      field: "password",
    };
  setPasswordHash(deps.db, user.id, await hashPassword(next.data));
  revokeAllLogins(deps.db, user.id, currentToken ?? undefined);
  return { ok: true };
}
