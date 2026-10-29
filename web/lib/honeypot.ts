import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Pièges à robots : ils détectent et ralentissent les automates SANS gêner les humains.
 *  - routes pièges : des adresses qu'aucun humain n'ouvre et que l'atelier ne publie pas
 *    (`/wp-admin`, `/.env`, `/api/debug`…) mais que les robots balaient ;
 *  - formulaires leurres : un champ caché aux humains (que seul un robot remplit) et un jeton
 *    d'horodatage signé (un formulaire envoyé moins de 2 secondes après son affichage est un robot).
 * Un client d'API ou un agent, qui n'envoie ni champ leurre ni jeton, n'est JAMAIS pris pour un robot :
 * les pièges ne jugent que ce que le formulaire HTML produit.
 */
export const DECOY_FIELD = "website";
export const FORM_TOKEN_FIELD = "_t";
export const MIN_FILL_MS = 2_000;

const TRAPS: RegExp[] = [
  /^\/admin(\/|$)/,
  /^\/administrator(\/|$)/,
  /^\/wp-(admin|content|includes|json)(\/|$)/,
  /^\/wp-login\.php$/,
  /^\/xmlrpc\.php$/,
  /^\/\.env(\.[a-z0-9._-]+)?$/,
  /^\/\.(git|svn|hg|aws|ssh|docker)(\/|$)/,
  /^\/\.ds_store$/,
  /^\/api\/debug(\/|$)/,
  /^\/(phpmyadmin|pma|myadmin|adminer(\.php)?)(\/|$)/,
  /^\/(server-status|server-info)$/,
  /^\/actuator(\/|$)/,
  /^\/cgi-bin(\/|$)/,
  /^\/boaform(\/|$)/,
  /^\/(config|backup|dump)\.(json|ya?ml|sql|zip|bak)$/,
];

/** Vrai pour une adresse que personne de légitime n'ouvre. La casse et la barre finale ne comptent pas. */
export function isTrapPath(pathname: string): boolean {
  const path = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  return TRAPS.some((pattern) => pattern.test(path));
}

// ── Jeton d'horodatage ────────────────────────────────────────────────────────────────────────
const PROCESS_KEY = randomBytes(32).toString("hex");
const defaultSecret = (): string => process.env.AQR_FORM_KEY || PROCESS_KEY;

const sign = (issuedAt: string, secret: string): string =>
  createHmac("sha256", secret)
    .update(`form/${issuedAt}`)
    .digest("hex")
    .slice(0, 16);

/** Jeton à glisser dans le formulaire rendu : `<horodatage>.<signature>`. */
export function issueFormToken(
  now = Date.now(),
  secret = defaultSecret(),
): string {
  const issuedAt = String(now);
  return `${issuedAt}.${sign(issuedAt, secret)}`;
}

function readToken(token: unknown, secret: string): number | null {
  if (typeof token !== "string") return null;
  const [issuedAt, signature] = token.split(".");
  if (!issuedAt || !signature || !/^\d{10,16}$/.test(issuedAt)) return null;
  const expected = Buffer.from(sign(issuedAt, secret));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return null;
  return Number(issuedAt);
}

export type FormVerdict =
  | { ok: true }
  | { ok: false; reason: "decoy_filled" | "too_fast" };

/**
 * Verdict sur les champs d'un formulaire. Un jeton absent, falsifié ou d'une autre clé ne condamne
 * personne (une page ouverte avant un redémarrage reste valable pour un humain) ; seuls comptent un
 * champ leurre rempli et un jeton AUTHENTIQUE trop récent.
 */
export function checkForm(
  fields: Record<string, unknown>,
  now = Date.now(),
  secret = defaultSecret(),
): FormVerdict {
  const decoy = fields[DECOY_FIELD];
  if (typeof decoy === "string" && decoy.trim() !== "")
    return { ok: false, reason: "decoy_filled" };
  const issuedAt = readToken(fields[FORM_TOKEN_FIELD], secret);
  if (issuedAt !== null && now - issuedAt < MIN_FILL_MS)
    return { ok: false, reason: "too_fast" };
  return { ok: true };
}
