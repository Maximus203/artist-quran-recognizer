import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { applyMigrations, loadMigrations } from "./migrate";
import { reviewRoot } from "./store";

/**
 * Base SQLite (module `node:sqlite` de Node : aucune dépendance native). Fichier :
 * `AQR_DB_PATH`, sinon `<AQR_REVIEW_DIR>/aqr.sqlite`. Mode WAL (lecteurs et écrivain ne se
 * bloquent pas), clés étrangères actives, `busy_timeout` (un second processus attend au lieu
 * d'échouer sur « database is locked »).
 */
export type Db = DatabaseSync;

export function dbPath(
  env: Record<string, string | undefined> = process.env,
): string {
  return path.resolve(
    /* turbopackIgnore: true */ env.AQR_DB_PATH ||
      path.join(reviewRoot(), "aqr.sqlite"),
  );
}

export function migrationsDir(): string {
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "db",
    "migrations",
  );
}

/** Ouvre (et migre) une base. `:memory:` pour les tests. */
export function openDatabase(file: string, migrations = migrationsDir()): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec("PRAGMA foreign_keys = ON");
    if (file !== ":memory:") {
      db.exec("PRAGMA journal_mode = WAL");
      db.exec("PRAGMA synchronous = NORMAL");
    }
    applyMigrations(db, loadMigrations(migrations));
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

const HOLDER = Symbol.for("aqr.database");
type Held = { file: string; db: Db };
/** Une connexion par processus (et par fichier) : Next charge ce module dans plusieurs bundles. */
export function getDb(): Db {
  const file = dbPath();
  const holder = globalThis as { [HOLDER]?: Held };
  const held = holder[HOLDER];
  if (held && held.file === file) return held.db;
  held?.db.close();
  const db = openDatabase(file);
  holder[HOLDER] = { file, db };
  return db;
}

/** Ferme la connexion partagée (tests, changement de dossier de données). */
export function closeDb(): void {
  const holder = globalThis as { [HOLDER]?: Held };
  holder[HOLDER]?.db.close();
  delete holder[HOLDER];
}

/** Exécute `work` dans une transaction (IMMEDIATE : prend le verrou d'écriture d'emblée). */
export function transaction<T>(db: Db, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
