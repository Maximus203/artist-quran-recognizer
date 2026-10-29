import { describe, expect, it } from "vitest";
import {
  buildCsp,
  callerKey,
  classify,
  crossSiteMutation,
  liveConnectSources,
  securityHeaders,
  tooLarge,
} from "./http-security";

describe("CSP", () => {
  const csp = buildCsp({ nonce: "abc123", connect: ["ws://127.0.0.1:8765"] });
  const directive = (name: string) =>
    csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

  it("scripts : origine + nonce, ni unsafe-inline ni unsafe-eval en production", () => {
    const script = directive("script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).not.toContain("unsafe-inline");
    expect(script).not.toContain("unsafe-eval");
    expect(script).not.toContain("strict-dynamic");
  });
  it("verrouille objets, cadres, base et formulaires", () => {
    expect(directive("object-src")).toBe("object-src 'none'");
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive("base-uri")).toBe("base-uri 'self'");
    expect(directive("form-action")).toBe("form-action 'self'");
    expect(directive("default-src")).toBe("default-src 'self'");
  });
  it("le direct peut se connecter au service déclaré, et à rien d'autre", () => {
    expect(directive("connect-src")).toBe(
      "connect-src 'self' ws://127.0.0.1:8765",
    );
  });
  it("le développement ajoute unsafe-eval pour le rechargement à chaud", () => {
    expect(buildCsp({ nonce: "n", dev: true })).toContain("'unsafe-eval'");
  });
  it("HTTPS : mise à niveau des ressources", () => {
    expect(buildCsp({ nonce: "n", secure: true })).toContain(
      "upgrade-insecure-requests",
    );
    expect(buildCsp({ nonce: "n" })).not.toContain("upgrade-insecure-requests");
  });
  it("origine du direct déduite de AQR_LIVE_URL", () => {
    expect(liveConnectSources("wss://live.example.org/live")).toEqual([
      "wss://live.example.org",
    ]);
    expect(liveConnectSources(undefined)).toEqual(["ws://127.0.0.1:8765"]);
    expect(liveConnectSources("http://x")).toEqual([]);
    expect(liveConnectSources("pas une url")).toEqual([]);
  });
});

describe("en-têtes de sécurité", () => {
  it("jeu complet ; HSTS seulement en HTTPS", () => {
    const plain = securityHeaders({ nonce: "n" });
    expect(plain["X-Content-Type-Options"]).toBe("nosniff");
    expect(plain["X-Frame-Options"]).toBe("DENY");
    expect(plain["Referrer-Policy"]).toBe("same-origin");
    expect(plain["Permissions-Policy"]).toContain("microphone=(self)");
    expect(plain["Permissions-Policy"]).toContain("camera=()");
    expect(plain["Strict-Transport-Security"]).toBeUndefined();
    expect(
      securityHeaders({ nonce: "n", secure: true })[
        "Strict-Transport-Security"
      ],
    ).toMatch(/max-age=31536000/);
  });
});

describe("familles de routes", () => {
  it.each([
    ["GET", "/_next/static/chunk.js", "static"],
    ["GET", "/login", "page"],
    ["GET", "/api/sessions", "read"],
    ["PATCH", "/api/sessions/abc", "write"],
    ["POST", "/api/sessions", "upload"],
    ["POST", "/api/v1/recordings", "upload"],
    ["PUT", "/api/me/avatar", "upload"],
    ["POST", "/api/sessions/abc/run", "generate"],
    ["POST", "/api/sessions/abc/export/video", "generate"],
    ["POST", "/api/v1/recordings/abc/export/video/jobs", "generate"],
    ["DELETE", "/api/sessions/abc/export/video/jobs/j1", "generate"],
    ["POST", "/api/auth/login", "auth"],
    ["POST", "/api/access", "auth"],
    ["POST", "/mcp", "mcp"],
    ["POST", "/api/mcp", "mcp"],
    ["POST", "/api/live/token", "live"],
  ])("%s %s → %s", (method, path, family) => {
    expect(classify(method, path)).toBe(family);
  });
});

describe("appelant et taille", () => {
  it("la clé garde une empreinte du cookie ou du jeton, jamais sa valeur", () => {
    const headers = new Headers({ cookie: "aqr_session=SECRETSECRET; x=1" });
    const key = callerKey(headers, "10.0.0.1");
    expect(key.ip).toBe("10.0.0.1");
    expect(key.account).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(key)).not.toContain("SECRET");
    expect(callerKey(new Headers(), "10.0.0.1").account).toBeNull();
    const bearer = callerKey(
      new Headers({ authorization: "Bearer qtr_abc" }),
      "x",
    );
    expect(bearer.account).toMatch(/^[0-9a-f]{16}$/);
  });
  it("corps JSON trop gros refusé ; les envois de fichiers sont bornés par leur route", () => {
    expect(tooLarge("POST", "write", String(2 * 1024 * 1024))).toBe(true);
    expect(tooLarge("POST", "write", "100")).toBe(false);
    expect(tooLarge("POST", "upload", String(900 * 1024 * 1024))).toBe(false);
    expect(tooLarge("GET", "read", "999999999")).toBe(false);
    expect(tooLarge("POST", "write", null)).toBe(false);
  });
});

describe("CSRF : requête inter-sites avec cookie", () => {
  const cookie = "aqr_session=abc";
  it("refusée si le navigateur dit « cross-site » ou « same-site » depuis un autre site", () => {
    expect(
      crossSiteMutation(
        "POST",
        new Headers({ cookie, "sec-fetch-site": "cross-site" }),
      ),
    ).toBe(true);
  });
  it("acceptée : même origine, navigation directe, lecture, sans cookie, sans en-tête", () => {
    const h = (extra: Record<string, string>) => new Headers(extra);
    expect(
      crossSiteMutation("POST", h({ cookie, "sec-fetch-site": "same-origin" })),
    ).toBe(false);
    expect(
      crossSiteMutation("POST", h({ cookie, "sec-fetch-site": "none" })),
    ).toBe(false);
    expect(
      crossSiteMutation("GET", h({ cookie, "sec-fetch-site": "cross-site" })),
    ).toBe(false);
    expect(
      crossSiteMutation("POST", h({ "sec-fetch-site": "cross-site" })),
    ).toBe(false);
    expect(crossSiteMutation("POST", h({ cookie }))).toBe(false);
  });
});
