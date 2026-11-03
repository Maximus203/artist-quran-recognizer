import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";

/**
 * Jeton de session du direct (ADR-0011, étape 3) : l'atelier l'émet après avoir authentifié
 * l'utilisateur (cookie de session), le service Python (`aqr live-serve`) le vérifie.
 *
 * Format `v1.<charge utile>.<signature>` (base64url sans remplissage), identique à
 * `src/aqr/adapters/ws/hmac_tokens.py` :
 *  - charge utile JSON `{ aud, sub, jti, iat, exp, tech }` (secondes) ;
 *  - signature HMAC-SHA256 de `aqr.live.token/1.<charge utile>` avec la clé partagée.
 * Le jeton ne contient ni nom, ni audio, ni texte ; il ne sert qu'une fois (le service retient `jti`).
 *
 * La clé n'est jamais dans le dépôt : `AQR_LIVE_KEY`, sinon un fichier local créé au premier
 * démarrage (`AQR_LIVE_KEY_FILE`, par défaut `<dossier de données>/live-signing.key`).
 */
export const LIVE_AUDIENCE = "aqr.live/1";
export const KEY_MIN_CHARS = 32;
export const KEY_FILE_NAME = "live-signing.key";
const VERSION = "v1";
const SIGNING_PREFIX = "aqr.live.token/1.";
const LEEWAY_S = 2;
const MAX_TTL_S = 300;
const DEFAULT_TTL_S = 60;
const DEFAULT_URL = "ws://127.0.0.1:8765/live";

export class LiveTokenError extends Error {
  readonly code: "token_invalid" | "token_expired";
  constructor(code: "token_invalid" | "token_expired") {
    super(code);
    this.code = code;
  }
}

const b64 = (data: Buffer | string): string =>
  Buffer.from(data).toString("base64url");

function sign(key: string, payloadB64: string): string {
  return createHmac("sha256", key)
    .update(SIGNING_PREFIX + payloadB64)
    .digest("base64url");
}

export type IssueOptions = {
  key: string;
  subject: string;
  ttlS: number;
  /** Millisecondes depuis l'epoch (injectable pour les tests). */
  now?: number;
  technical?: boolean;
  jti?: string;
};

export function issueLiveToken({
  key,
  subject,
  ttlS,
  now = Date.now(),
  technical = false,
  jti = b64(randomBytes(16)),
}: IssueOptions): string {
  if (key.length < KEY_MIN_CHARS)
    throw new Error(
      `la clé de signature doit faire au moins ${KEY_MIN_CHARS} caractères`,
    );
  if (!subject) throw new Error("compte vide");
  if (!Number.isFinite(ttlS) || ttlS <= 0 || ttlS > MAX_TTL_S)
    throw new Error(`durée du jeton hors de ]0, ${MAX_TTL_S}] s`);
  const iat = Math.floor(now / 1000);
  const body = b64(
    JSON.stringify({
      aud: LIVE_AUDIENCE,
      sub: subject,
      jti,
      iat,
      exp: iat + ttlS,
      tech: technical,
    }),
  );
  return `${VERSION}.${body}.${sign(key, body)}`;
}

export type LiveClaims = {
  subject: string;
  tokenId: string;
  expiresAt: number;
  technical: boolean;
};

/** Vérifie un jeton (tests et outils ; en production c'est le service Python qui le fait). */
export function verifyLiveToken(
  token: string,
  key: string,
  now = Date.now(),
): LiveClaims {
  const parts = typeof token === "string" ? token.split(".") : [];
  if (parts.length !== 3 || parts[0] !== VERSION || token.length > 1024)
    throw new LiveTokenError("token_invalid");
  const [, body, signature] = parts;
  const expected = Buffer.from(sign(key, body));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    throw new LiveTokenError("token_invalid");
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
  } catch {
    throw new LiveTokenError("token_invalid");
  }
  const { aud, sub, jti, iat, exp, tech } = payload;
  if (
    aud !== LIVE_AUDIENCE ||
    typeof sub !== "string" ||
    !sub ||
    typeof jti !== "string" ||
    !jti ||
    typeof iat !== "number" ||
    typeof exp !== "number" ||
    typeof tech !== "boolean"
  )
    throw new LiveTokenError("token_invalid");
  const seconds = now / 1000;
  if (iat > seconds + LEEWAY_S) throw new LiveTokenError("token_invalid");
  if (exp + LEEWAY_S < seconds) throw new LiveTokenError("token_expired");
  return { subject: sub, tokenId: jti, expiresAt: exp, technical: tech };
}

// ── Clé ────────────────────────────────────────────────────────────────────────────────────────
type Env = Record<string, string | undefined>;

/**
 * Clé de signature : `AQR_LIVE_KEY`, sinon le fichier local (créé s'il n'existe pas, de façon
 * atomique : si l'atelier et le service démarrent ensemble, un seul écrit et l'autre relit).
 */
export function resolveLiveKey(env: Env, dataDir: string): string {
  const direct = (env.AQR_LIVE_KEY ?? "").trim();
  if (direct) {
    if (direct.length < KEY_MIN_CHARS)
      throw new Error(
        `AQR_LIVE_KEY est trop courte (au moins ${KEY_MIN_CHARS} caractères)`,
      );
    return direct;
  }
  const file = env.AQR_LIVE_KEY_FILE || path.join(dataDir, KEY_FILE_NAME);
  if (!existsSync(file)) {
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      const fd = openSync(file, "wx", 0o600);
      try {
        writeSync(fd, `${b64(randomBytes(32))}\n`);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  let key = readFileSync(file, "utf-8").trim();
  for (let attempt = 0; attempt < 20 && !key; attempt += 1) {
    // un autre processus vient de créer le fichier et n'a pas fini d'écrire
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    key = readFileSync(file, "utf-8").trim();
  }
  if (key.length < KEY_MIN_CHARS)
    throw new Error(
      `la clé de signature ${file} est trop courte ou vide : la supprimer`,
    );
  return key;
}

// ── Configuration ─────────────────────────────────────────────────────────────────────────────
export type LiveConfig =
  | { ok: true; url: string; ttlS: number }
  | { ok: false; message: string };

/** Adresse WebSocket que le navigateur doit joindre et durée de vie du jeton. */
export function liveConfig(env: Env): LiveConfig {
  const raw = (env.AQR_LIVE_URL ?? "").trim() || DEFAULT_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, message: "AQR_LIVE_URL n'est pas une adresse valide." };
  }
  if (
    (url.protocol !== "ws:" && url.protocol !== "wss:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return {
      ok: false,
      message:
        "AQR_LIVE_URL doit être une adresse ws:// ou wss:// sans identifiant ni paramètre.",
    };
  const ttl = Number(env.AQR_LIVE_TOKEN_TTL_S);
  const ttlS =
    Number.isInteger(ttl) && ttl > 0 && ttl <= MAX_TTL_S ? ttl : DEFAULT_TTL_S;
  return { ok: true, url: raw, ttlS };
}
