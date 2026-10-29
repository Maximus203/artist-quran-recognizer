import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Déconnexion et « fermer les autres connexions » : le jeton est invalidé CÔTÉ SERVEUR. */
let dir = "";
let userId = 0;
let DELETE: typeof import("./route").DELETE;
let POST: typeof import("../../auth/logout/route").POST;
let mint: () => string;
let alive: (token: string) => Promise<boolean>;

const withCookie = (token: string, method: string) =>
  new Request("http://127.0.0.1:3000/x", {
    method,
    headers: { cookie: `aqr_session=${token}` },
  });

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-logins-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig, resolveLogin } = await import("@/lib/auth");
  const db = getDb();
  userId = createUser(db, { username: "awa", passwordHash: "x" }).id;
  mint = () => createLogin(db, userId, authConfig());
  alive = async (token) => resolveLogin(db, token, authConfig()) !== null;
  ({ DELETE } = await import("./route"));
  ({ POST } = await import("../../auth/logout/route"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { getDb } = await import("@/lib/db");
  getDb().close();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("fermer les autres connexions", () => {
  it("révoque les autres appareils, garde celui qui demande", async () => {
    const phone = mint();
    const laptop = mint();
    const tablet = mint();
    const response = await DELETE(withCookie(laptop, "DELETE"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revoked: 2 });
    expect(await alive(laptop)).toBe(true);
    expect(await alive(phone)).toBe(false);
    expect(await alive(tablet)).toBe(false);
  });
  it("sans connexion : 401", async () => {
    expect(
      (
        await DELETE(
          new Request("http://127.0.0.1:3000/x", { method: "DELETE" }),
        )
      ).status,
    ).toBe(401);
  });
});

describe("déconnexion", () => {
  it("le jeton est invalidé côté serveur et le cookie effacé ; rejouer le jeton échoue", async () => {
    const token = mint();
    expect(await alive(token)).toBe(true);
    const response = await POST(withCookie(token, "POST"));
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(
      /aqr_session=; .*Max-Age=0/,
    );
    expect(await alive(token)).toBe(false);
    // rejouer l'ancien cookie sur une route protégée : refusé
    const replay = await DELETE(withCookie(token, "DELETE"));
    expect(replay.status).toBe(401);
  });
  it("idempotente sans connexion", async () => {
    expect(
      (await POST(new Request("http://127.0.0.1:3000/x", { method: "POST" })))
        .status,
    ).toBe(204);
  });
});
