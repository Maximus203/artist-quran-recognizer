import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Section 9 : formulaires leurres et verdict de robot ; brute force ralenti puis bloqué, humain épargné. */
let dir = "";
let login: typeof import("./auth/login/route").POST;
let register: typeof import("./auth/register/route").POST;
let issue: typeof import("@/lib/honeypot").issueFormToken;
const PASSWORD = "cheval agrafe pile batterie";

const post = (url: string, body: unknown, ip: string) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
const asLogin = (body: unknown, ip: string) =>
  login(post("http://127.0.0.1:3000/api/auth/login", body, ip));
const asRegister = (body: unknown, ip: string) =>
  register(post("http://127.0.0.1:3000/api/auth/register", body, ip));

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-honeypot-api-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  vi.stubEnv("AQR_TRUST_PROXY", "1");
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { hashPassword } = await import("@/lib/passwords");
  createUser(getDb(), {
    username: "awa",
    passwordHash: await hashPassword(PASSWORD),
  });
  ({ POST: login } = await import("./auth/login/route"));
  ({ POST: register } = await import("./auth/register/route"));
  ({ issueFormToken: issue } = await import("@/lib/honeypot"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

const rows = async (table: string) => {
  const { getDb } = await import("@/lib/db");
  return (
    getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
  ).n;
};

describe("un humain n'est pas pris pour un robot", () => {
  it("formulaire rempli en 6 s, champ leurre vide → connexion normale", async () => {
    const token = issue(Date.now() - 6_000);
    const response = await asLogin(
      { username: "awa", password: PASSWORD, website: "", _t: token },
      "198.51.100.10",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("aqr_session=");
  });
  it("client d'API ou agent, sans champ leurre ni jeton → connexion normale", async () => {
    const response = await asLogin(
      { username: "awa", password: PASSWORD },
      "198.51.100.11",
    );
    expect(response.status).toBe(200);
  });
  it("une vieille page (jeton illisible ou d'une autre clé) n'empêche pas de se connecter", async () => {
    const response = await asLogin(
      {
        username: "awa",
        password: PASSWORD,
        _t: "1700000000000.deadbeefdeadbeef",
      },
      "198.51.100.12",
    );
    expect(response.status).toBe(200);
  });
});

describe("un robot est refusé en silence", () => {
  it("champ leurre rempli : même réponse qu'un mot de passe faux, aucun cookie, adresse bloquée, passage journalisé", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const before = await rows("blocked_addresses");
    const response = await asLogin(
      {
        username: "awa",
        password: PASSWORD,
        website: "http://spam.example",
        _t: issue(Date.now() - 9_000),
      },
      "203.0.113.50",
    );
    const lines = spy.mock.calls.map((c) => String(c[0])).join("\n");
    spy.mockRestore();
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await response.json()).error).toBe(
      "Pseudonyme ou mot de passe incorrect.",
    );
    expect(await rows("blocked_addresses")).toBe(before + 1);
    expect(lines).toContain('"event":"honeypot.form"');
    expect(lines).toContain('"reason":"decoy_filled"');
    expect(lines).not.toContain("203.0.113.50");
    expect(lines).not.toContain("spam.example");
  });

  it("même un mot de passe CORRECT ne passe pas quand le champ leurre est rempli", async () => {
    const response = await asLogin(
      { username: "awa", password: PASSWORD, website: "x" },
      "203.0.113.51",
    );
    expect(response.status).toBe(401);
  });

  it("formulaire envoyé moins de 2 s après son affichage : refusé, mais l'adresse n'est PAS bloquée (un gestionnaire de mots de passe va vite)", async () => {
    const before = await rows("blocked_addresses");
    const response = await asLogin(
      { username: "awa", password: PASSWORD, _t: issue(Date.now()) },
      "203.0.113.52",
    );
    expect(response.status).toBe(401);
    expect(await rows("blocked_addresses")).toBe(before);
  });

  it("inscription par un robot : refusée, aucun compte créé", async () => {
    const users = await rows("users");
    const response = await asRegister(
      {
        username: "robot1",
        password: "une phrase de passe tres longue 2026",
        website: "http://spam.example",
        _t: issue(Date.now() - 9_000),
      },
      "203.0.113.53",
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe(
      "Inscription impossible pour l'instant.",
    );
    expect(await rows("users")).toBe(users);
  });

  it("sans adresse réelle (pas de proxy de confiance), on refuse sans bloquer personne", async () => {
    vi.stubEnv("AQR_TRUST_PROXY", "");
    const before = await rows("blocked_addresses");
    const response = await asLogin(
      { username: "awa", password: PASSWORD, website: "x" },
      "203.0.113.54",
    );
    vi.stubEnv("AQR_TRUST_PROXY", "1");
    expect(response.status).toBe(401);
    expect(await rows("blocked_addresses")).toBe(before);
  });
});

describe("brute force : ralenti puis bloqué ; une erreur isolée ne coûte rien", () => {
  it("un humain qui se trompe une fois peut aussitôt se connecter", async () => {
    const ip = "198.51.100.20";
    expect(
      (await asLogin({ username: "awa", password: "mauvaise phrase 1" }, ip))
        .status,
    ).toBe(401);
    expect(
      (await asLogin({ username: "awa", password: PASSWORD }, ip)).status,
    ).toBe(200);
  });

  it("un script qui essaie des mots de passe est verrouillé de plus en plus longtemps, même avec le bon mot de passe", async () => {
    const ip = "198.51.100.21";
    const statuses: number[] = [];
    for (let i = 0; i < 9; i++)
      statuses.push(
        (
          await asLogin(
            { username: "awa", password: `essai numéro ${i} raté` },
            ip,
          )
        ).status,
      );
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
    const locked = await asLogin({ username: "awa", password: PASSWORD }, ip);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });
});
