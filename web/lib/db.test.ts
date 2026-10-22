import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, transaction, type Db } from "./db";
import { createUser } from "./users";

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());

const names = () =>
  (
    db.prepare("SELECT username FROM users ORDER BY id").all() as {
      username: string;
    }[]
  ).map((row) => row.username);
const add = (username: string) =>
  createUser(db, { username, passwordHash: "x" });

describe("transaction réentrante", () => {
  it("valide l'ensemble quand tout réussit, imbrication comprise", () => {
    transaction(db, () => {
      add("Un");
      transaction(db, () => add("Deux"));
    });
    expect(names()).toEqual(["Un", "Deux"]);
  });

  it("annule tout quand l'extérieur échoue", () => {
    expect(() =>
      transaction(db, () => {
        add("Un");
        transaction(db, () => add("Deux"));
        throw new Error("échec");
      }),
    ).toThrow("échec");
    expect(names()).toEqual([]);
  });

  it("n'annule que la partie imbriquée quand elle échoue et que l'extérieur la rattrape", () => {
    transaction(db, () => {
      add("Un");
      try {
        transaction(db, () => {
          add("Deux");
          throw new Error("interne");
        });
      } catch {
        /* rattrapée */
      }
      add("Trois");
    });
    expect(names()).toEqual(["Un", "Trois"]);
  });

  it("repart propre après une erreur : une nouvelle transaction fonctionne", () => {
    expect(() =>
      transaction(db, () => {
        throw new Error("x");
      }),
    ).toThrow();
    transaction(db, () => add("Apres"));
    expect(names()).toEqual(["Apres"]);
  });
});
