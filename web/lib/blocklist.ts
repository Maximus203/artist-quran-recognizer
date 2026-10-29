import { createHmac } from "node:crypto";
import type { Db } from "./db";

/**
 * Adresses bloquées après un passage sur un piège (voir `honeypot.ts`). Le blocage s'allonge à chaque
 * récidive (1 h, 6 h, 24 h, 3 j, 7 j) et un passage de plus de 30 jours est oublié. La table ne garde
 * jamais l'adresse : seulement son empreinte HMAC (`AQR_AUDIT_SALT`), donc elle permet de reconnaître
 * une adresse qui se présente, pas de dresser la liste de ceux qui sont venus.
 *
 * Une adresse « locale » ou « inconnue » n'est JAMAIS bloquée : sans proxy de confiance, toutes les
 * requêtes partagent la même, et bloquer l'une bloquerait tout le monde.
 */
const HOUR = 3_600_000;
export const STRIKE_DURATIONS_MS = [
  1 * HOUR,
  6 * HOUR,
  24 * HOUR,
  72 * HOUR,
  7 * 24 * HOUR,
];
const FORGET_AFTER_MS = 30 * 24 * HOUR;
const UNKNOWN = new Set(["", "local", "unknown"]);

export type Strike = { hash: string; strikes: number; blockedUntil: number };
export type BlockedRow = {
  hash: string;
  reason: string;
  strikes: number;
  firstAt: number;
  lastAt: number;
  blockedUntil: number;
};

export class BlockList {
  constructor(
    private readonly db: Db,
    private readonly salt: string = process.env.AQR_AUDIT_SALT || "aqr-audit",
  ) {}

  private hash(ip: string): string {
    return createHmac("sha256", this.salt).update(`block/${ip}`).digest("hex");
  }

  isBlocked(ip: string, now = Date.now()): boolean {
    if (UNKNOWN.has(ip)) return false;
    const row = this.db
      .prepare("SELECT blocked_until FROM blocked_addresses WHERE ip_hash = ?")
      .get(this.hash(ip)) as { blocked_until: number } | undefined;
    return row !== undefined && row.blocked_until > now;
  }

  /** Enregistre un passage et bloque pour la durée qui correspond à la récidive. */
  strike(ip: string, reason: string, now = Date.now()): Strike {
    if (UNKNOWN.has(ip)) return { hash: "", strikes: 0, blockedUntil: 0 };
    const hash = this.hash(ip);
    const previous = this.db
      .prepare(
        "SELECT strikes, last_at, first_at FROM blocked_addresses WHERE ip_hash = ?",
      )
      .get(hash) as
      | { strikes: number; last_at: number; first_at: number }
      | undefined;
    const fresh = !previous || now - previous.last_at > FORGET_AFTER_MS;
    const strikes = fresh ? 1 : previous.strikes + 1;
    const duration =
      STRIKE_DURATIONS_MS[Math.min(strikes, STRIKE_DURATIONS_MS.length) - 1];
    const blockedUntil = now + duration;
    this.db
      .prepare(
        `INSERT INTO blocked_addresses (ip_hash, reason, strikes, first_at, last_at, blocked_until)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(ip_hash) DO UPDATE SET
           reason = excluded.reason, strikes = excluded.strikes, first_at = excluded.first_at,
           last_at = excluded.last_at, blocked_until = excluded.blocked_until`,
      )
      .run(
        hash,
        reason,
        strikes,
        fresh ? now : previous.first_at,
        now,
        blockedUntil,
      );
    return { hash, strikes, blockedUntil };
  }

  /** Lève un blocage : `id` est l'adresse OU l'empreinte (64 caractères hexadécimaux) donnée par la liste. */
  lift(id: string): boolean {
    const hash = /^[0-9a-f]{64}$/.test(id) ? id : this.hash(id);
    return (
      this.db
        .prepare("DELETE FROM blocked_addresses WHERE ip_hash = ?")
        .run(hash).changes > 0
    );
  }

  /** Blocages en cours, du plus récent au plus ancien. */
  active(limit = 100, now = Date.now()): BlockedRow[] {
    return (
      this.db
        .prepare(
          `SELECT ip_hash, reason, strikes, first_at, last_at, blocked_until FROM blocked_addresses
           WHERE blocked_until > ? ORDER BY last_at DESC LIMIT ?`,
        )
        .all(now, limit) as Array<{
        ip_hash: string;
        reason: string;
        strikes: number;
        first_at: number;
        last_at: number;
        blocked_until: number;
      }>
    ).map((row) => ({
      hash: row.ip_hash,
      reason: row.reason,
      strikes: row.strikes,
      firstAt: row.first_at,
      lastAt: row.last_at,
      blockedUntil: row.blocked_until,
    }));
  }

  /** Oublie les blocages expirés depuis plus de 7 jours (la récidive reste comptée pendant 30 jours via `last_at`). */
  purge(now = Date.now()): number {
    return this.db
      .prepare("DELETE FROM blocked_addresses WHERE blocked_until < ?")
      .run(now - 7 * 24 * HOUR).changes as number;
  }
}
