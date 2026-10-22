import { describe, expect, it } from "vitest";
import { FailureLimiter, HitLimiter } from "./rate-limit";

const options = {
  threshold: 3,
  baseLockMs: 10_000,
  maxLockMs: 60_000,
  windowMs: 300_000,
};

describe("FailureLimiter : verrouillage progressif", () => {
  it("laisse passer sous le seuil, puis verrouille", () => {
    const limiter = new FailureLimiter(options);
    limiter.fail("k", 0);
    limiter.fail("k", 1);
    expect(limiter.check("k", 2).allowed).toBe(true);
    limiter.fail("k", 2);
    const verdict = limiter.check("k", 3);
    expect(verdict).toEqual({ allowed: false, retryAfterS: 10 });
  });

  it("double le verrou à chaque échec, plafonné", () => {
    const limiter = new FailureLimiter(options);
    for (let i = 0; i < 3; i++) limiter.fail("k", 0);
    expect(limiter.check("k", 0)).toEqual({ allowed: false, retryAfterS: 10 });
    limiter.fail("k", 10_000); // 4e échec : 20 s
    expect(limiter.check("k", 10_000)).toEqual({
      allowed: false,
      retryAfterS: 20,
    });
    limiter.fail("k", 30_000); // 5e : 40 s
    limiter.fail("k", 70_000); // 6e : 80 s → plafonné à 60 s
    expect(limiter.check("k", 70_000)).toEqual({
      allowed: false,
      retryAfterS: 60,
    });
  });

  it("autorise de nouveau une fois le verrou écoulé", () => {
    const limiter = new FailureLimiter(options);
    for (let i = 0; i < 3; i++) limiter.fail("k", 0);
    expect(limiter.check("k", 10_001).allowed).toBe(true);
  });

  it("un succès remet la clé à zéro", () => {
    const limiter = new FailureLimiter(options);
    limiter.fail("k", 0);
    limiter.fail("k", 0);
    limiter.succeed("k");
    limiter.fail("k", 1);
    limiter.fail("k", 1);
    expect(limiter.check("k", 2).allowed).toBe(true);
  });

  it("oublie une clé silencieuse depuis la fenêtre", () => {
    const limiter = new FailureLimiter(options);
    limiter.fail("k", 0);
    limiter.fail("k", 0);
    limiter.fail("k", 500_000); // 2 échecs anciens oubliés : on repart à 1
    limiter.fail("k", 500_001);
    expect(limiter.check("k", 500_002).allowed).toBe(true);
  });

  it("isole les clés et borne la mémoire", () => {
    const limiter = new FailureLimiter({ ...options, maxKeys: 5 });
    for (let i = 0; i < 3; i++) limiter.fail("a", 0);
    expect(limiter.check("b", 1).allowed).toBe(true);
    for (let i = 0; i < 20; i++) limiter.fail(`k${i}`, 0);
    expect(limiter.size).toBeLessThanOrEqual(5);
  });
});

describe("HitLimiter : événements par fenêtre", () => {
  it("refuse au-delà du maximum puis réautorise à l'expiration", () => {
    const limiter = new HitLimiter(2, 1000);
    expect(limiter.hit("ip", 0).allowed).toBe(true);
    expect(limiter.hit("ip", 100).allowed).toBe(true);
    expect(limiter.hit("ip", 200)).toEqual({ allowed: false, retryAfterS: 1 });
    expect(limiter.hit("autre", 200).allowed).toBe(true);
    expect(limiter.hit("ip", 1001).allowed).toBe(true);
  });
});
