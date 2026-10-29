import { createHmac } from "node:crypto";
import { log } from "./log";

/**
 * Journal d'audit des événements de sécurité (connexions, échecs, verrouillages, changements de mot
 * de passe) : une ligne JSON par événement, par le journal unique (`log.ts`). Jamais de mot de passe,
 * de jeton ni de cookie ; l'adresse IP n'est écrite que pseudonymisée (HMAC tronqué : la même adresse
 * donne la même empreinte, sans qu'on puisse la relire). Le compte est désigné par son numéro.
 */
export type AuditEvent =
  | "login.success"
  | "login.failure"
  | "login.locked"
  | "register"
  | "password.change"
  | "password.change_failed"
  | "logout"
  | "logins.revoked_others"
  | "account.unlock"
  | "visibility.change"
  | "honeypot.form"
  | "block.lifted"
  | "token.created"
  | "token.revoked";

export type AuditFields = {
  userId?: number | null;
  ip?: string;
  reason?: string;
  /** Session concernée (identifiant opaque, jamais son titre). */
  session?: string;
};

export function pseudonymize(
  ip: string,
  salt = process.env.AQR_AUDIT_SALT || "aqr-audit",
): string {
  return createHmac("sha256", salt).update(ip).digest("hex").slice(0, 12);
}

export function audit(event: AuditEvent, fields: AuditFields = {}): void {
  const payload: Record<string, string | number> = {};
  if (fields.userId !== undefined && fields.userId !== null)
    payload.user = fields.userId;
  if (fields.ip) payload.ip = pseudonymize(fields.ip);
  if (fields.reason) payload.reason = fields.reason;
  if (fields.session) payload.session = fields.session;
  log.event("audit", event, payload);
}
