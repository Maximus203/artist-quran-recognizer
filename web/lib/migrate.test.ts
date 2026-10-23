import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { migrationsDir, openDatabase } from "./db";
import { applyMigrations, loadMigrations } from "./migrate";

const dirs: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aqr-mig-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("migrations versionnées", () => {
  it("applique la migration réelle et crée les tables attendues", () => {
    const db = openDatabase(":memory:");
    const tables = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    for (const name of [
      "users",
      "auth_sessions",
      "preferences",
      "session_meta",
      "favorites",
      "views",
      "analysis_log",
      "schema_migrations",
    ])
      expect(tables).toContain(name);
    db.close();
  });

  it("est idempotent : un second passage n'applique rien", () => {
    const db = new DatabaseSync(":memory:");
    const migrations = loadMigrations(migrationsDir());
    const all = migrations.map((m) => m.version);
    expect(applyMigrations(db, migrations)).toEqual(all);
    expect(applyMigrations(db, migrations)).toEqual([]);
    const rows = db.prepare("SELECT version FROM schema_migrations").all();
    expect(rows).toHaveLength(all.length);
    db.close();
  });

  it("002 : une base existante (migration 001 seule) gagne les colonnes de photo sans rien perdre", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    const migrations = loadMigrations(migrationsDir());
    expect(applyMigrations(db, migrations.slice(0, 1))).toEqual([1]);
    db.prepare(
      `INSERT INTO users (username, username_key, password_hash, role, created_at)
       VALUES ('Awa', 'awa', 'h', 'user', '2026-10-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO session_meta (id, owner_id, name, original_name, created_at, updated_at)
       VALUES ('s1', 1, 'Session', 'a.mp3', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z')`,
    ).run();
    expect(applyMigrations(db, migrations)).toEqual([2]);
    expect(applyMigrations(db, migrations)).toEqual([]);
    const user = db.prepare("SELECT * FROM users WHERE id = 1").get() as Record<
      string,
      unknown
    >;
    expect(user.username).toBe("Awa");
    expect(user.avatar_hash).toBeNull();
    expect(user.avatar_updated_at).toBeNull();
    expect(
      (
        db
          .prepare("SELECT owner_id FROM session_meta WHERE id = 's1'")
          .get() as {
          owner_id: number;
        }
      ).owner_id,
    ).toBe(1);
    db.close();
  });

  it("applique dans l'ordre et ne rejoue que les nouvelles", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "001_a.sql"), "CREATE TABLE a (x INTEGER);");
    const db = new DatabaseSync(":memory:");
    expect(applyMigrations(db, loadMigrations(dir))).toEqual([1]);
    writeFileSync(path.join(dir, "002_b.sql"), "CREATE TABLE b (y INTEGER);");
    expect(applyMigrations(db, loadMigrations(dir))).toEqual([2]);
    db.close();
  });

  it("refuse une migration modifiée après son application", () => {
    const dir = tmp();
    const file = path.join(dir, "001_a.sql");
    writeFileSync(file, "CREATE TABLE a (x INTEGER);");
    const db = new DatabaseSync(":memory:");
    applyMigrations(db, loadMigrations(dir));
    writeFileSync(file, "CREATE TABLE a (x INTEGER, z INTEGER);");
    expect(() => applyMigrations(db, loadMigrations(dir))).toThrow(
      /modifiée après son application/,
    );
    db.close();
  });

  it("annule une migration en échec sans la consigner", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "001_a.sql"), "CREATE TABLE a (x INTEGER);");
    writeFileSync(
      path.join(dir, "002_bad.sql"),
      "CREATE TABLE b (y INTEGER); INSERT INTO inexistante VALUES (1);",
    );
    const db = new DatabaseSync(":memory:");
    expect(() => applyMigrations(db, loadMigrations(dir))).toThrow();
    const versions = (
      db.prepare("SELECT version FROM schema_migrations").all() as {
        version: number;
      }[]
    ).map((row) => row.version);
    expect(versions).toEqual([1]);
    const b = db
      .prepare("SELECT name FROM sqlite_master WHERE name = 'b'")
      .get();
    expect(b).toBeUndefined();
    db.close();
  });

  it("refuse deux migrations de même numéro", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "001_a.sql"), "SELECT 1;");
    writeFileSync(path.join(dir, "001_b.sql"), "SELECT 1;");
    expect(() => loadMigrations(dir)).toThrow(/numéro 1/);
  });

  it("ignore les fichiers qui ne sont pas des migrations", () => {
    const dir = tmp();
    writeFileSync(path.join(dir, "001_a.sql"), "SELECT 1;");
    writeFileSync(path.join(dir, "notes.md"), "x");
    expect(loadMigrations(dir)).toHaveLength(1);
  });

  it("active les clés étrangères : une revue sans compte est refusée", () => {
    const db = openDatabase(":memory:");
    expect(() =>
      db
        .prepare(
          "INSERT INTO favorites (user_id, session_id, created_at) VALUES (99, 'x', 'now')",
        )
        .run(),
    ).toThrow();
    db.close();
  });

  it("ouvre un fichier en mode WAL", () => {
    const dir = tmp();
    const db = openDatabase(path.join(dir, "t.sqlite"));
    const mode = db.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    expect(mode.journal_mode).toBe("wal");
    db.close();
  });
});
