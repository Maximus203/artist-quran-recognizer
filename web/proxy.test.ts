import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const req = (
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
) => new NextRequest(`http://127.0.0.1:3000${path}`, init);

describe("proxy : en-têtes et identifiant", () => {
  it("une page reçoit CSP à nonce, en-têtes de sécurité et un identifiant de requête", () => {
    const response = proxy(req("/login"));
    expect(response.status).toBe(200);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("deux requêtes n'ont ni le même nonce ni le même identifiant", () => {
    const a = proxy(req("/login"));
    const b = proxy(req("/login"));
    expect(a.headers.get("x-request-id")).not.toBe(
      b.headers.get("x-request-id"),
    );
    expect(a.headers.get("content-security-policy")).not.toBe(
      b.headers.get("content-security-policy"),
    );
  });
});

describe("fichiers servis par l'API", () => {
  it.each(["/api/sessions/x/audio", "/api/sessions/x/video", "/api/sessions/x/bundle", "/api/users/1/avatar"])(
    "%s est servi avec nosniff et hors de tout cadre",
    (path) => {
      const response = proxy(req(path));
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    },
  );
});

describe("proxy : refus avant toute route", () => {
  it("modification inter-sites avec cookie de connexion : 403", async () => {
    const response = proxy(
      req("/api/me/password", {
        method: "POST",
        headers: { cookie: "aqr_session=abc", "sec-fetch-site": "cross-site" },
      }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("cross_site");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("même requête depuis le même site : passe", () => {
    const response = proxy(
      req("/api/me/password", {
        method: "POST",
        headers: { cookie: "aqr_session=abc", "sec-fetch-site": "same-origin" },
      }),
    );
    expect(response.status).toBe(200);
  });
  it("corps JSON de plus de 1 Mio : 413", async () => {
    const response = proxy(
      req("/api/me/preferences", {
        method: "PATCH",
        headers: { "content-length": String(5 * 1024 * 1024) },
      }),
    );
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("payload_too_large");
  });
  it("l'envoi d'un fichier n'est pas plafonné ici (sa route le borne)", () => {
    const response = proxy(
      req("/api/sessions", {
        method: "POST",
        headers: { "content-length": String(300 * 1024 * 1024) },
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("proxy : limitation de débit", () => {
  it("la famille « auth » répond 429 avec Retry-After au-delà du plafond, sans bloquer les autres familles", async () => {
    let last = proxy(req("/api/auth/login", { method: "POST" }));
    for (let i = 0; i < 40 && last.status !== 429; i++)
      last = proxy(req("/api/auth/login", { method: "POST" }));
    expect(last.status).toBe(429);
    expect(Number(last.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    const body = await last.json();
    expect(body.code).toBe("rate_limited");
    expect(body.error).toMatch(/réessaie dans \d+ s/);
    // une autre famille n'est pas touchée
    expect(proxy(req("/api/sessions")).status).toBe(200);
  });
  it("la famille « generate » (30 par minute) est plafonnée aussi pour un compte identifié", () => {
    const as = () =>
      req("/api/sessions/x/run", {
        method: "POST",
        headers: { cookie: `aqr_session=${"A".repeat(43)}` },
      });
    let last = proxy(as());
    for (let i = 0; i < 40 && last.status !== 429; i++) last = proxy(as());
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBeTruthy();
  });
});
