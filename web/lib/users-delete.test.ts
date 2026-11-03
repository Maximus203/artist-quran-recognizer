import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db";
import { createInvitation } from "./invitations";
import {
  LastAdminError,
  SelfDeleteError,
  createUser,
  deleteUser,
  getUser,
  updateUser,
} from "./users";

/** Supprimer un compte : réservé à l'administrateur, jamais soi-même ni le dernier administrateur actif. */
let db: Db;
let admin: number;
let other: number;
let reciter: number;

beforeEach(() => {
  db = openDatabase(":memory:");
  admin = createUser(db, { username: "Cherif", passwordHash: "x" }).id;
  other = createUser(db, { username: "Awa", passwordHash: "x" }).id;
  reciter = createUser(db, {
    username: "Imam",
    passwordHash: "x",
    role: "recitant",
  }).id;
});
afterEach(() => db.close());

const count = (table: string, where = "1=1") =>
  (
    db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get() as {
      n: number;
    }
  ).n;

describe("deleteUser", () => {
  it("supprime le compte, ses connexions et ses préférences", () => {
    db.prepare(
      `INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
       VALUES ('h', ?, 'a', 'a', 'z')`,
    ).run(reciter);
    db.prepare(
      "INSERT INTO preferences (user_id, key, value, updated_at) VALUES (?, 'theme', '\"dark\"', 'a')",
    ).run(reciter);
    expect(deleteUser(db, reciter, admin)).toBe(true);
    expect(getUser(db, reciter)).toBeNull();
    expect(count("auth_sessions", `user_id = ${reciter}`)).toBe(0);
    expect(count("preferences", `user_id = ${reciter}`)).toBe(0);
  });

  it("un compte inconnu : faux, rien ne change", () => {
    expect(deleteUser(db, 999, admin)).toBe(false);
    expect(count("users")).toBe(3);
  });

  it("refuse de supprimer son propre compte", () => {
    expect(() => deleteUser(db, admin, admin)).toThrow(SelfDeleteError);
    expect(getUser(db, admin)).not.toBeNull();
  });

  it("refuse de supprimer le dernier administrateur actif", () => {
    updateUser(db, other, { role: "admin" });
    updateUser(db, other, { disabled: true });
    expect(() => deleteUser(db, admin, other)).toThrow(LastAdminError);
    expect(getUser(db, admin)).not.toBeNull();
  });

  it("supprime un autre administrateur quand il en reste un actif", () => {
    updateUser(db, other, { role: "admin" });
    expect(deleteUser(db, other, admin)).toBe(true);
    expect(getUser(db, other)).toBeNull();
  });

  it("garde les invitations d'un administrateur supprimé, rattachées à celui qui supprime", () => {
    updateUser(db, other, { role: "admin" });
    createInvitation(db, { label: "Fatou", createdBy: other });
    expect(deleteUser(db, other, admin)).toBe(true);
    expect(count("invitations", `created_by = ${admin}`)).toBe(1);
  });

  it("garde les agents du moteur d'un administrateur supprimé, rattachés à celui qui supprime", () => {
    updateUser(db, other, { role: "admin" });
    db.prepare(
      `INSERT INTO engine_agents (name, token_hash, prefix, created_by, created_at, priority)
       VALUES ('gpu', 'th', 'pfx', ?, 'a', 10)`,
    ).run(other);
    expect(deleteUser(db, other, admin)).toBe(true);
    expect(count("engine_agents", `created_by = ${admin}`)).toBe(1);
  });
});
