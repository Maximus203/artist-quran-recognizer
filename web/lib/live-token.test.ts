import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KEY_MIN_CHARS,
  issueLiveToken,
  liveConfig,
  resolveLiveKey,
  verifyLiveToken,
} from "./live-token";

/** Vecteurs communs avec `tests/unit/test_live_tokens.py` : l'accord entre Python et TypeScript. */
const vectors = JSON.parse(
  readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "tests",
      "fixtures",
      "live",
      "token-vectors.json",
    ),
    "utf-8",
  ),
);
const KEY = "k".repeat(40);
const NOW = 1_800_000_000_000;
const temps: string[] = [];
const tmp = () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aqr-live-"));
  temps.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temps.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("jeton de session du direct", () => {
  it("a trois parties : version, charge utile lisible, signature", () => {
    const token = issueLiveToken({
      key: KEY,
      subject: "7",
      ttlS: 60,
      now: NOW,
    });
    const [version, body, signature] = token.split(".");
    expect(version).toBe("v1");
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf-8"),
    );
    expect(Object.keys(payload).sort()).toEqual([
      "aud",
      "exp",
      "iat",
      "jti",
      "sub",
      "tech",
    ]);
    expect(payload).toMatchObject({ aud: "aqr.live/1", sub: "7", tech: false });
    expect(payload.exp - payload.iat).toBe(60);
    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("ne contient jamais de nom, d'audio ni de texte, et ne se répète pas", () => {
    const a = issueLiveToken({ key: KEY, subject: "7", ttlS: 60, now: NOW });
    const b = issueLiveToken({ key: KEY, subject: "7", ttlS: 60, now: NOW });
    expect(a).not.toBe(b);
  });

  it("se vérifie, et refuse une autre clé, une charge modifiée ou un jeton expiré", () => {
    const token = issueLiveToken({
      key: KEY,
      subject: "7",
      ttlS: 60,
      now: NOW,
    });
    expect(verifyLiveToken(token, KEY, NOW + 1000)).toMatchObject({
      subject: "7",
    });
    expect(() => verifyLiveToken(token, "z".repeat(40), NOW)).toThrow(
      "token_invalid",
    );
    const [v, , s] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        aud: "aqr.live/1",
        sub: "1",
        jti: "x",
        iat: NOW / 1000,
        exp: NOW / 1000 + 60,
        tech: false,
      }),
    ).toString("base64url");
    expect(() => verifyLiveToken(`${v}.${forged}.${s}`, KEY, NOW)).toThrow(
      "token_invalid",
    );
    expect(() => verifyLiveToken(token, KEY, NOW + 70_000)).toThrow(
      "token_expired",
    );
    expect(() => verifyLiveToken("n'importe quoi", KEY, NOW)).toThrow(
      "token_invalid",
    );
  });

  it("n'accorde le mode technique que si on le demande", () => {
    expect(
      verifyLiveToken(
        issueLiveToken({
          key: KEY,
          subject: "7",
          ttlS: 60,
          now: NOW,
          technical: true,
        }),
        KEY,
        NOW,
      ).technical,
    ).toBe(true);
    expect(
      verifyLiveToken(
        issueLiveToken({ key: KEY, subject: "7", ttlS: 60, now: NOW }),
        KEY,
        NOW,
      ).technical,
    ).toBe(false);
  });

  it("refuse une clé courte, un compte vide et une durée absurde", () => {
    expect(() =>
      issueLiveToken({ key: "court", subject: "7", ttlS: 60, now: NOW }),
    ).toThrow();
    expect(() =>
      issueLiveToken({ key: KEY, subject: "", ttlS: 60, now: NOW }),
    ).toThrow();
    expect(() =>
      issueLiveToken({ key: KEY, subject: "7", ttlS: 0, now: NOW }),
    ).toThrow();
    expect(() =>
      issueLiveToken({ key: KEY, subject: "7", ttlS: 3600, now: NOW }),
    ).toThrow();
  });

  it("est le même jeton que celui du service Python (vecteurs communs)", () => {
    const python = vectors.python_token;
    expect(verifyLiveToken(python, vectors.key, vectors.now_ms)).toMatchObject({
      subject: vectors.subject,
    });
    const own = issueLiveToken({
      key: vectors.key,
      subject: vectors.subject,
      ttlS: vectors.ttl_s,
      now: vectors.now_ms,
      jti: vectors.jti,
      technical: false,
    });
    expect(own).toBe(vectors.ts_token);
    expect(
      verifyLiveToken(vectors.ts_token, vectors.key, vectors.now_ms).subject,
    ).toBe(vectors.subject);
  });
});

describe("clé de signature", () => {
  it("vient de l'environnement d'abord", () => {
    const dir = tmp();
    expect(
      resolveLiveKey({ AQR_LIVE_KEY: "e".repeat(KEY_MIN_CHARS) }, dir),
    ).toBe("e".repeat(KEY_MIN_CHARS));
    expect(() => resolveLiveKey({ AQR_LIVE_KEY: "court" }, dir)).toThrow(
      "trop courte",
    );
  });

  it("est créée une fois dans le dossier de données, puis relue", () => {
    const dir = tmp();
    const first = resolveLiveKey({}, dir);
    const second = resolveLiveKey({}, dir);
    expect(first).toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(KEY_MIN_CHARS);
    expect(
      readFileSync(path.join(dir, "live-signing.key"), "utf-8").trim(),
    ).toBe(first);
  });

  it("respecte AQR_LIVE_KEY_FILE et refuse un fichier trop court", () => {
    const dir = tmp();
    const file = path.join(dir, "autre.key");
    writeFileSync(file, "court\n");
    expect(() => resolveLiveKey({ AQR_LIVE_KEY_FILE: file }, dir)).toThrow(
      "trop courte",
    );
  });
});

describe("configuration du direct", () => {
  it("donne l'adresse locale par défaut", () => {
    expect(liveConfig({})).toEqual({
      ok: true,
      url: "ws://127.0.0.1:8765/live",
      ttlS: 60,
    });
  });

  it("accepte une adresse publique en wss et une durée bornée", () => {
    expect(
      liveConfig({
        AQR_LIVE_URL: "wss://lab.example/live",
        AQR_LIVE_TOKEN_TTL_S: "30",
      }),
    ).toEqual({
      ok: true,
      url: "wss://lab.example/live",
      ttlS: 30,
    });
    expect(liveConfig({ AQR_LIVE_TOKEN_TTL_S: "9999" })).toMatchObject({
      ttlS: 60,
    });
  });

  it("refuse une adresse qui n'est pas du WebSocket, ou qui porte un secret", () => {
    for (const url of [
      "http://x.example/live",
      "ws://u:p@x.example/live",
      "ws://x.example/live?t=1",
      "pas une url",
    ])
      expect(liveConfig({ AQR_LIVE_URL: url })).toMatchObject({ ok: false });
  });
});
