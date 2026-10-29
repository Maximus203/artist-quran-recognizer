import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "./db";
import { DbFailureStore } from "./failure-store";
import { FailureLimiter } from "./rate-limit";

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => db.close());

const options = {
  threshold: 3,
  baseLockMs: 1000,
  maxLockMs: 60_000,
  windowMs: 10_000,
};
const limiter = (scope = "login") =>
  new FailureLimiter({ ...options, store: new DbFailureStore(db, scope) });

describe("échecs de connexion persistants", () => {
  it("le verrouillage survit à un redémarrage (nouveau limiteur, même base)", () => {
    const before = limiter();
    for (let i = 0; i < 3; i++) before.fail("ip:1.2.3.4:awa", 5000);
    expect(before.check("ip:1.2.3.4:awa", 5001).allowed).toBe(false);
    const after = limiter(); // « redémarrage »
    const verdict = after.check("ip:1.2.3.4:awa", 5001);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) expect(verdict.retryAfterS).toBeGreaterThanOrEqual(1);
  });

  it("le verrou double et se plafonne comme en mémoire", () => {
    const l = limiter();
    for (let i = 0; i < 3; i++) l.fail("k", 0); // 1 s
    expect(l.check("k", 999).allowed).toBe(false);
    expect(l.check("k", 1000).allowed).toBe(true);
    l.fail("k", 1000); // 4e échec : 2 s
    expect(l.check("k", 2999).allowed).toBe(false);
    expect(l.check("k", 3000).allowed).toBe(true);
  });

  it("un succès efface la clé, une clé silencieuse est oubliée", () => {
    const l = limiter();
    l.fail("k", 0);
    l.succeed("k");
    expect(l.size).toBe(0);
    l.fail("autre", 0);
    expect(l.check("autre", 20_000).allowed).toBe(true);
    l.fail("autre", 20_001); // la fenêtre est écoulée : on repart de 1
    expect(
      (db.prepare("SELECT fails FROM auth_failures").get() as { fails: number })
        .fails,
    ).toBe(1);
  });

  it("ne garde ni adresse IP ni pseudonyme en clair", () => {
    const l = limiter();
    l.fail("login:203.0.113.77:moussa_diallo", 0);
    const rows = db.prepare("SELECT * FROM auth_failures").all();
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain("203.0.113.77");
    expect(dump).not.toContain("moussa");
    expect((rows[0] as { key_hash: string }).key_hash).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });

  it("les portées sont isolées : même clé, deux limiteurs", () => {
    const a = limiter("a");
    const b = limiter("b");
    for (let i = 0; i < 3; i++) a.fail("k", 0);
    expect(a.check("k", 1).allowed).toBe(false);
    expect(b.check("k", 1).allowed).toBe(true);
  });

  it("borne la table (maxKeys) en oubliant d'abord les plus anciennes", () => {
    const l = new FailureLimiter({
      ...options,
      maxKeys: 5,
      store: new DbFailureStore(db, "login"),
    });
    for (let i = 0; i < 12; i++) l.fail(`k${i}`, i);
    expect(l.size).toBeLessThanOrEqual(5);
  });
});
