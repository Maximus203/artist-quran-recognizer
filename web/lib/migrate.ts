import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Migrations versionnées : `db/migrations/NNN_nom.sql`, appliquées dans l'ordre, chacune dans sa
 * transaction, et consignées dans `schema_migrations` avec l'empreinte de leur contenu.
 *  - idempotent : une migration déjà appliquée n'est jamais rejouée ;
 *  - immuable : modifier le contenu d'une migration appliquée est une erreur (on en ajoute une
 *    nouvelle), sinon deux machines auraient deux schémas sous le même numéro ;
 *  - sûr en concurrence : la transaction est IMMEDIATE et l'état est relu à l'intérieur.
 */
export type Migration = { version: number; name: string; sql: string };

const FILE = /^(\d{3,})_([a-z0-9_]+)\.sql$/;

export function loadMigrations(dir: string): Migration[] {
  const found = readdirSync(dir)
    .map((file) => ({ file, match: FILE.exec(file) }))
    .filter((entry) => entry.match !== null)
    .map(({ file, match }) => ({
      version: Number((match as RegExpExecArray)[1]),
      name: (match as RegExpExecArray)[2],
      sql: readFileSync(path.join(dir, file), "utf8"),
    }))
    .sort((a, b) => a.version - b.version);
  for (let i = 1; i < found.length; i++)
    if (found[i].version === found[i - 1].version)
      throw new Error(`Deux migrations portent le numéro ${found[i].version}.`);
  return found;
}

const checksum = (sql: string) =>
  createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");

export function applyMigrations(
  db: DatabaseSync,
  migrations: readonly Migration[],
  now = () => new Date().toISOString(),
): number[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       checksum   TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
  const applied: number[] = [];
  for (const migration of migrations) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const done = db
        .prepare("SELECT checksum FROM schema_migrations WHERE version = ?")
        .get(migration.version) as { checksum: string } | undefined;
      const sum = checksum(migration.sql);
      if (done) {
        if (done.checksum !== sum)
          throw new Error(
            `La migration ${migration.version}_${migration.name} a été modifiée après son application : ajoute une nouvelle migration au lieu de la changer.`,
          );
      } else {
        db.exec(migration.sql);
        db.prepare(
          "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
        ).run(migration.version, migration.name, sum, now());
        applied.push(migration.version);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return applied;
}
