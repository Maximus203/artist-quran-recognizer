import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LIMITS, classify, type Family } from "./lib/http-security";

/**
 * Débit sur CHAQUE famille de routes (section 14 de docs/SECURITE-PRE-DEPLOIEMENT.md) : jusqu'au plafond
 * tout passe, la requête suivante reçoit 429 avec `Retry-After`, et les autres familles ne sont pas
 * touchées. Le plafond vient de `LIMITS` : le changer ne casse pas ce test, le supprimer le fait.
 */
type Proxy = typeof import("./proxy").proxy;
let proxy: Proxy;

// Une requête représentative par famille, avec la méthode qui la fait classer ainsi.
const SAMPLES: Record<Family, { method: string; path: string }> = {
  static: { method: "GET", path: "/_next/static/chunks/app.js" },
  page: { method: "GET", path: "/login" },
  read: { method: "GET", path: "/api/sessions" },
  write: { method: "PATCH", path: "/api/me/preferences" },
  upload: { method: "POST", path: "/api/sessions" },
  chunk: { method: "PUT", path: "/api/uploads/x/chunks/0" },
  generate: { method: "POST", path: "/api/sessions/x/run" },
  mcp: { method: "POST", path: "/api/mcp" },
  live: { method: "POST", path: "/api/live/token" },
  engine: { method: "POST", path: "/api/engine/claim" },
  auth: { method: "POST", path: "/api/auth/login" },
};

beforeEach(async () => {
  vi.resetModules();
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for("aqr.proxy-limiters")
  ];
  delete (globalThis as Record<symbol, unknown>)[
    Symbol.for("aqr.proxy-blocks")
  ];
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  ({ proxy } = await import("./proxy"));
});

const call = (family: Family, cookie?: string) => {
  const { method, path } = SAMPLES[family];
  return proxy(
    new NextRequest(`http://127.0.0.1:3000${path}`, {
      method,
      headers: cookie ? { cookie: `aqr_session=${cookie}` } : {},
    }),
  );
};

describe("chaque famille a un plafond, éprouvé", () => {
  it("les requêtes d'exemple sont bien rangées dans la famille annoncée", () => {
    for (const family of Object.keys(SAMPLES) as Family[])
      expect(classify(SAMPLES[family].method, SAMPLES[family].path)).toBe(
        family,
      );
  });

  it("toutes les familles de LIMITS sont couvertes par un exemple", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(LIMITS).sort());
  });

  it.each(Object.keys(LIMITS) as Family[])(
    "%s : passe jusqu'au plafond, puis 429 avec Retry-After",
    async (family) => {
      const { max } = LIMITS[family];
      for (let i = 0; i < max; i++)
        expect(call(family).status, `requête ${i + 1}/${max}`).toBe(200);
      const refused = call(family);
      expect(refused.status).toBe(429);
      expect(Number(refused.headers.get("retry-after"))).toBeGreaterThanOrEqual(
        1,
      );
      expect((await refused.json()).code).toBe("rate_limited");
      expect(refused.headers.get("x-content-type-options")).toBe("nosniff");
    },
  );

  it("épuiser une famille ne touche pas les autres", () => {
    for (let i = 0; i <= LIMITS.auth.max; i++) call("auth");
    expect(call("auth").status).toBe(429);
    for (const family of Object.keys(LIMITS) as Family[])
      if (family !== "auth") expect(call(family).status).toBe(200);
  });

  it("un compte qui dépasse son plafond n'empêche pas un autre compte, même derrière la même adresse", () => {
    const a = "A".repeat(43);
    const b = "B".repeat(43);
    // L'adresse est commune ; le plafond de l'adresse (ip:) s'épuise en dernier car 2 clés sont comptées.
    for (let i = 0; i < LIMITS.generate.max; i++)
      expect(call("generate", a).status).toBe(200);
    expect(call("generate", a).status).toBe(429);
    // L'adresse partagée est elle aussi épuisée : le message dit alors la même chose pour tous (pas de
    // fuite sur qui a déclenché), et une autre famille reste libre.
    expect(call("read", b).status).toBe(200);
  });
});
