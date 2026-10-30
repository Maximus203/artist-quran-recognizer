import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Réinitialisation d'un mot de passe par un administrateur : un mot de passe TEMPORAIRE, montré une seule fois,
 * les connexions du compte sont révoquées, et le verrou de connexion levé. Un testeur ne le peut jamais.
 */
let dir = "";
let cookies = { admin: "", user: "", target: "" };
let ids = { admin: 0, target: 0 };
let POST: typeof import("./route").POST;
let login: (
  username: string,
  password: string,
  ip?: string,
) => Promise<{ ok: boolean }>;
let newLogin: (userId: number) => string;
let resolve: (cookie: string) => unknown;

const call = (
  who: "admin" | "user" | null,
  id: number | string,
  headers: Record<string, string> = {},
) =>
  POST(
    new Request(`http://127.0.0.1:3000/api/admin/users/${id}/password`, {
      method: "POST",
      headers: {
        ...(who ? { cookie: `aqr_session=${cookies[who]}` } : {}),
        ...headers,
      },
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-admin-reset-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig, loginAccount, resolveLogin } = await import(
    "@/lib/auth"
  );
  const { hashPassword } = await import("@/lib/passwords");
  const { authDeps } = await import("@/lib/route-guard");
  const db = getDb();
  const hash = await hashPassword("ancien mot de passe 2026");
  const admin = createUser(db, { username: "admin1", passwordHash: hash });
  const user = createUser(db, { username: "simple", passwordHash: hash });
  const target = createUser(db, { username: "cible", passwordHash: hash });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  ids = { admin: admin.id, target: target.id };
  const cfg = authConfig();
  cookies = {
    admin: createLogin(db, admin.id, cfg),
    user: createLogin(db, user.id, cfg),
    target: createLogin(db, target.id, cfg),
  };
  login = async (username, password, ip = "10.0.0.9") =>
    loginAccount(await authDeps(), { username, password }, ip);
  newLogin = (userId) => createLogin(db, userId, cfg);
  resolve = (cookie) => resolveLogin(db, cookie, cfg);
  ({ POST } = await import("./route"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("droits", () => {
  it("sans connexion : 401 ; testeur : 403 ; rien n'est changé", async () => {
    expect((await call(null, ids.target)).status).toBe(401);
    expect((await call("user", ids.target)).status).toBe(403);
    expect((await login("cible", "ancien mot de passe 2026")).ok).toBe(true);
  });

  it("compte inconnu ou identifiant absurde : 404", async () => {
    for (const id of [99999, 0, -3, "abc", "1.5"])
      expect((await call("admin", id)).status, String(id)).toBe(404);
  });

  it("un administrateur n'utilise pas cette route pour lui-même (Compte > Sécurité existe)", async () => {
    const res = await call("admin", ids.admin);
    expect(res.status).toBe(400);
    expect((await login("admin1", "ancien mot de passe 2026")).ok).toBe(true);
  });
});

describe("réinitialisation", () => {
  it("rend un mot de passe temporaire lisible, une seule fois, sans mise en cache", async () => {
    const res = await call("admin", ids.target);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    const { password, username } = await res.json();
    expect(username).toBe("cible");
    expect(password).toMatch(/^[a-z2-9]{5}(-[a-z2-9]{5}){3}$/);
    expect(password).not.toMatch(/[ilo01]/); // pas de caractères qui se confondent à la lecture
    // Le nouveau mot de passe ouvre le compte, l'ancien ne l'ouvre plus.
    expect((await login("cible", password)).ok).toBe(true);
    expect((await login("cible", "ancien mot de passe 2026")).ok).toBe(false);
  });

  it("chaque appel donne un mot de passe différent", async () => {
    const one = (await (await call("admin", ids.target)).json()).password;
    const two = (await (await call("admin", ids.target)).json()).password;
    expect(one).not.toBe(two);
  });

  it("les connexions en cours du compte sont révoquées (un voleur de cookie perd l'accès)", async () => {
    const cookie = newLogin(ids.target); // une connexion neuve, comme un voleur de cookie en aurait une
    expect(resolve(cookie)).not.toBeNull();
    await call("admin", ids.target);
    expect(resolve(cookie)).toBeNull();
  });

  it("l'administrateur lui-même reste connecté", async () => {
    await call("admin", ids.target);
    expect(resolve(cookies.admin)).not.toBeNull();
  });

  it("lève aussi le verrou de connexion du compte (attaque répartie)", async () => {
    // Des adresses différentes : seul le verrou « par compte » (toutes adresses) se pose.
    for (let i = 0; i < 12; i++)
      await login("cible", `faux-${i}-mot-de-passe`, `10.1.0.${i + 1}`);
    expect((await login("cible", "ancien", "10.2.0.1")).ok).toBe(false);
    const { password } = await (await call("admin", ids.target)).json();
    expect((await login("cible", password, "10.2.0.2")).ok).toBe(true);
  });
});
