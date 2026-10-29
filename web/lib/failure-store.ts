import { createHash } from "node:crypto";
import type { Db } from "./db";
import type { FailureEntry, FailureStore } from "./rate-limit";

/**
 * Échecs de connexion gardés en base (table `auth_failures`) : le verrouillage progressif survit à
 * un redémarrage du serveur. La clé (adresse, pseudonyme) n'est jamais écrite en clair : seule
 * l'empreinte SHA-256 de « portée + clé » l'est.
 */
export class DbFailureStore implements FailureStore {
  constructor(
    private readonly db: Db,
    private readonly scope: string,
  ) {}

  private hash(key: string): string {
    return createHash("sha256").update(`${this.scope}\0${key}`).digest("hex");
  }

  get(key: string): FailureEntry | undefined {
    const row = this.db
      .prepare(
        "SELECT fails, last_at, locked_until FROM auth_failures WHERE key_hash = ?",
      )
      .get(this.hash(key)) as
      | { fails: number; last_at: number; locked_until: number }
      | undefined;
    return row
      ? { fails: row.fails, last: row.last_at, lockedUntil: row.locked_until }
      : undefined;
  }

  set(key: string, entry: FailureEntry): void {
    this.db
      .prepare(
        `INSERT INTO auth_failures (key_hash, scope, fails, last_at, locked_until)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key_hash) DO UPDATE SET
           fails = excluded.fails, last_at = excluded.last_at, locked_until = excluded.locked_until`,
      )
      .run(
        this.hash(key),
        this.scope,
        entry.fails,
        entry.last,
        entry.lockedUntil,
      );
  }

  delete(key: string): void {
    this.db
      .prepare("DELETE FROM auth_failures WHERE key_hash = ?")
      .run(this.hash(key));
  }

  size(): number {
    return (
      this.db
        .prepare("SELECT COUNT(*) AS n FROM auth_failures WHERE scope = ?")
        .get(this.scope) as { n: number }
    ).n;
  }

  prune(now: number, windowMs: number, max: number): void {
    this.db
      .prepare(
        "DELETE FROM auth_failures WHERE scope = ? AND locked_until <= ? AND ? - last_at > ?",
      )
      .run(this.scope, now, now, windowMs);
    const excess = this.size() - max;
    if (excess > 0)
      this.db
        .prepare(
          `DELETE FROM auth_failures WHERE key_hash IN (
             SELECT key_hash FROM auth_failures WHERE scope = ? ORDER BY last_at ASC LIMIT ?)`,
        )
        .run(this.scope, excess);
  }
}
