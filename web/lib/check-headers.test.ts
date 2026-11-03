import { describe, expect, it } from "vitest";
import { evaluateHeaders } from "../scripts/check-headers.mjs";
import { securityHeaders } from "./http-security";

const good = (secure: boolean) =>
  new Headers(
    securityHeaders({ nonce: "abcdEFGH12345678", dev: false, secure }),
  );

describe("contrôleur d'en-têtes (équivalent local de securityheaders.com)", () => {
  it("les en-têtes que l'atelier émet réellement passent, en HTTPS comme en HTTP", () => {
    expect(evaluateHeaders(good(true), { https: true })).toEqual([]);
    expect(evaluateHeaders(good(false), { https: false })).toEqual([]);
  });

  it("HSTS est exigé en HTTPS seulement", () => {
    expect(evaluateHeaders(good(false), { https: true }).join(" ")).toMatch(
      /strict-transport-security absent/,
    );
    expect(evaluateHeaders(good(false), { https: false })).toEqual([]);
  });

  it.each([
    [
      "CSP absente",
      "content-security-policy",
      null,
      /Content-Security-Policy absent/,
    ],
    [
      "script-src sans nonce",
      "content-security-policy",
      "default-src 'self'; script-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      /sans nonce/,
    ],
    [
      "unsafe-inline dans script-src",
      "content-security-policy",
      "default-src 'self'; script-src 'self' 'nonce-abcdEFGH1234' 'unsafe-inline'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
      /unsafe-inline/,
    ],
    [
      "nosniff retiré",
      "x-content-type-options",
      null,
      /x-content-type-options absent/,
    ],
    ["cadre autorisé", "x-frame-options", "ALLOWALL", /DENY/],
    ["technologie exposée", "x-powered-by", "Next.js", /X-Powered-By/],
    ["version du serveur exposée", "server", "nginx/1.25.3", /Server expose/],
  ])("%s est signalé", (_label, name, value, expected) => {
    const headers = good(false);
    if (value === null) headers.delete(name);
    else headers.set(name, value);
    expect(evaluateHeaders(headers, { https: false }).join(" | ")).toMatch(
      expected,
    );
  });
});
