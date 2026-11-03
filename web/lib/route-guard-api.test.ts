import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Identification par jeton d'API derrière un tunnel : le mode distant exige un jeton d'accès
 * (`AQR_ACCESS_TOKEN`) pour toute requête ; un jeton `qtr_…` valide en tient lieu, MAIS seulement
 * sur un hôte autorisé et seulement pour les routes d'essais.
 */
const LAB = "lab.example.test";
let dir = "";
let token = "";
let authenticate: typeof import("./route-guard").authenticate;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-guard-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  vi.stubEnv("AQR_ACCESS_TOKEN", "secret-acces-test");
  vi.stubEnv("AQR_ALLOWED_HOSTS", LAB);
  vi.stubEnv("AQR_PUBLIC_ORIGIN", `https://${LAB}`);
  const { getDb } = await import("./db");
  const { createUser } = await import("./users");
  const { createApiToken } = await import("./api-tokens");
  const db = getDb();
  const user = createUser(db, { username: "awa", passwordHash: "x" });
  token = createApiToken(db, {
    userId: user.id,
    name: "agent",
    scope: "write",
  }).token;
  ({ authenticate } = await import("./route-guard"));
});

afterAll(async () => {
  vi.unstubAllEnvs();
  const { getDb } = await import("./db");
  getDb().close();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const req = (
  url: string,
  headers: Record<string, string>,
  method = "GET",
): Request => new Request(url, { method, headers });

describe("authenticate avec un jeton d'API", () => {
  it("accepte le jeton sur l'hôte du tunnel, sans jeton d'accès", async () => {
    const result = await authenticate(
      req("http://127.0.0.1:3000/api/v1/me", {
        host: LAB,
        authorization: `Bearer ${token}`,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.api?.scope).toBe("write");
  });

  it("refuse un hôte inconnu, même avec un jeton valide", async () => {
    const result = await authenticate(
      req("http://127.0.0.1:3000/api/v1/me", {
        host: "evil.example",
        authorization: `Bearer ${token}`,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(403);
  });

  it("refuse une requête sans identifiant sur l'hôte du tunnel", async () => {
    const result = await authenticate(
      req("http://127.0.0.1:3000/api/v1/me", { host: LAB }),
    );
    expect(result.ok).toBe(false);
  });

  it("refuse un jeton inventé", async () => {
    const result = await authenticate(
      req("http://127.0.0.1:3000/api/v1/me", {
        host: LAB,
        authorization: `Bearer qtr_${"a".repeat(43)}`,
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(401);
  });

  it("n'ouvre ni les jetons ni l'administration à un jeton", async () => {
    for (const pathname of ["/api/me/tokens", "/api/admin/users"]) {
      const result = await authenticate(
        req(`http://127.0.0.1:3000${pathname}`, {
          host: LAB,
          authorization: `Bearer ${token}`,
        }),
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(403);
    }
  });
});
