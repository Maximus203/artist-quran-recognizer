import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Mots de passe : scrypt (node:crypto, aucune dépendance native). L'empreinte stockée porte ses
 * propres paramètres : `scrypt$N$r$p$<sel b64>$<empreinte b64>`. On peut donc durcir les valeurs
 * plus tard sans invalider les comptes existants (voir `needsRehash`).
 * Valeurs d'aujourd'hui : N = 2^17, r = 8, p = 1 (≈ 128 Mo, ≈ 250 ms) : la première configuration
 * minimale de la fiche « Password Storage » de l'OWASP (2^17 / r = 8 / p = 1 ; 2^16 exigerait p = 2 et
 * 2^15 p = 3). Les anciennes empreintes (2^15, p = 1) sont plus faibles : `needsRehash` les fait
 * refaire à la connexion suivante. `AQR_SCRYPT_LOG_N` (12 à 20) ne sert qu'aux tests et au
 * diagnostic : la production refuse de démarrer sous 17 (`runtime-guard.ts`).
 */
export type ScryptParams = { N: number; r: number; p: number };
export const SCRYPT_MIN_LOG_N = 17;
export function scryptParams(
  env: Record<string, string | undefined> = process.env,
): ScryptParams {
  const log = Number(env.AQR_SCRYPT_LOG_N);
  const logN =
    Number.isInteger(log) && log >= 12 && log <= 20 ? log : SCRYPT_MIN_LOG_N;
  return { N: 2 ** logN, r: 8, p: 1 };
}
const KEY_BYTES = 32;
const SALT_BYTES = 16;
/** Bornes acceptées en lecture : une empreinte forgée ne doit pas faire exploser la mémoire. */
const MAX_N = 1 << 20;
const MAX_R = 16;
const MAX_P = 4;

const derive = (
  password: string,
  salt: Buffer,
  { N, r, p }: ScryptParams,
  length = KEY_BYTES,
): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      salt,
      length,
      { N, r, p, maxmem: 160 * N * r + 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );

export async function hashPassword(
  password: string,
  params: ScryptParams = scryptParams(),
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, params);
  return `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

type Parsed = ScryptParams & { salt: Buffer; key: Buffer };

function parse(stored: string): Parsed | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [N, r, p] = parts.slice(1, 4).map((value) => Number(value));
  const valid =
    Number.isInteger(N) &&
    N >= 2 &&
    N <= MAX_N &&
    (N & (N - 1)) === 0 &&
    Number.isInteger(r) &&
    r >= 1 &&
    r <= MAX_R &&
    Number.isInteger(p) &&
    p >= 1 &&
    p <= MAX_P;
  if (!valid) return null;
  const salt = Buffer.from(parts[4], "base64");
  const key = Buffer.from(parts[5], "base64");
  return salt.length >= 8 && key.length >= 16 ? { N, r, p, salt, key } : null;
}

/** Vrai si le mot de passe correspond ; comparaison à temps constant, jamais d'exception. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  try {
    const key = await derive(password, parsed.salt, parsed, parsed.key.length);
    return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
  } catch {
    return false;
  }
}

/** L'empreinte a été faite avec des paramètres plus faibles que ceux d'aujourd'hui. */
export function needsRehash(
  stored: string,
  params: ScryptParams = scryptParams(),
): boolean {
  const parsed = parse(stored);
  return (
    !parsed || parsed.N < params.N || parsed.r < params.r || parsed.p < params.p
  );
}

let dummy: Promise<string> | undefined;
/**
 * Connexion avec un pseudonyme inconnu : on vérifie quand même un mot de passe contre une empreinte
 * factice pour que la durée de réponse ne révèle pas si le compte existe.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummy ??= hashPassword("aqr-dummy-password-never-valid");
  await verifyPassword(password, await dummy);
  return false;
}
