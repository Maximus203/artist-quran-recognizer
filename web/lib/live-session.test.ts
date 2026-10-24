import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLiveSession } from "./live-session";
import { verifyLiveToken, resolveLiveKey } from "./live-token";
import { HitLimiter } from "./rate-limit";

const NOW = 1_800_000_000_000;
const dirs: string[] = [];
const dataDir = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aqr-live-session-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
const user = { id: 7, role: "user" as const };
const admin = { id: 1, role: "admin" as const };
const limiter = () => new HitLimiter(3, 60_000);

function run(
  overrides: Partial<Parameters<typeof createLiveSession>[0]> = {},
  dir = dataDir(),
) {
  return {
    dir,
    result: createLiveSession({
      user,
      body: {},
      env: {},
      dataDir: dir,
      limiter: limiter(),
      now: NOW,
      ...overrides,
    }),
  };
}

describe("émission du jeton de session du direct", () => {
  it("donne un jeton signé lié au compte, son adresse et son échéance", () => {
    const { dir, result } = run();
    expect(result.status).toBe(200);
    if (result.status !== 200) return;
    expect(result.body).toMatchObject({
      schema: "aqr.live/1",
      url: "ws://127.0.0.1:8765/live",
      ttl_s: 60,
      technical: false,
      expires_at: new Date(NOW + 60_000).toISOString(),
    });
    const claims = verifyLiveToken(
      result.body.token,
      resolveLiveKey({}, dir),
      NOW,
    );
    expect(claims.subject).toBe("7");
    expect(claims.technical).toBe(false);
  });

  it("n'accorde le mode technique qu'à qui le demande, éteint par défaut, ouvert à tous", () => {
    const ask = { technical: true };
    for (const who of [user, admin]) {
      const asked = run({ user: who, body: ask }).result;
      const quiet = run({ user: who, body: {} }).result;
      expect(asked.status === 200 && asked.body.technical).toBe(true);
      expect(quiet.status === 200 && quiet.body.technical).toBe(false);
    }
  });

  it("limite les émissions par compte", () => {
    const shared = limiter();
    const dir = dataDir();
    const codes = Array.from(
      { length: 5 },
      () =>
        createLiveSession({
          user,
          body: {},
          env: {},
          dataDir: dir,
          limiter: shared,
          now: NOW,
        }).status,
    );
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const other = createLiveSession({
      user: admin,
      body: {},
      env: {},
      dataDir: dir,
      limiter: shared,
      now: NOW,
    });
    expect(other.status).toBe(200);
  });

  it("dit clairement quand le service n'est pas configuré correctement", () => {
    const { result } = run({ env: { AQR_LIVE_URL: "http://x.example/live" } });
    expect(result).toMatchObject({ status: 503, code: "live_unavailable" });
  });

  it("refuse un corps qui n'est pas un objet ou un champ mal typé", () => {
    for (const body of ["texte", 12, [1], { technical: "oui" }])
      expect(run({ body }).result).toMatchObject({ status: 400 });
  });

  it("ne met jamais la clé dans sa réponse", () => {
    const { dir, result } = run();
    expect(JSON.stringify(result)).not.toContain(resolveLiveKey({}, dir));
  });
});
