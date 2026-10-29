import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authConfig,
  changePassword,
  clearedCookie,
  createLimiters,
  createLogin,
  hashToken,
  loginAccount,
  loginCookie,
  newToken,
  readCookie,
  registerAccount,
  resolveLogin,
  revokeLogin,
  sessionToken,
  signupStatus,
  type AuthConfig,
  type AuthDeps,
} from "./auth";
import { openDatabase, type Db } from "./db";
import { updateUser } from "./users";

const PASSWORD = "mot de passe correct 42";
let db: Db;
let clock: number;
let cfg: AuthConfig;

const deps = (): AuthDeps => ({
  db,
  cfg,
  limiters: limiters,
  now: () => clock,
});
let limiters: ReturnType<typeof createLimiters>;

beforeEach(() => {
  db = openDatabase(":memory:");
  clock = Date.UTC(2026, 9, 22, 12, 0, 0);
  cfg = authConfig({});
  limiters = createLimiters(cfg);
});
afterEach(() => db.close());

const register = (username: string, extra: object = {}) =>
  registerAccount(deps(), { username, password: PASSWORD, ...extra }, "ip1");
const login = (username: string, password = PASSWORD, ip = "ip1") =>
  loginAccount(deps(), { username, password }, ip);

describe("configuration", () => {
  it("lit les valeurs, avec des défauts sûrs", () => {
    expect(authConfig({}).ttlS).toBe(30 * 86400);
    expect(authConfig({}).signup).toBe("open");
    expect(authConfig({ AQR_LOGIN_TTL_DAYS: "7" }).ttlS).toBe(7 * 86400);
    expect(authConfig({ AQR_LOGIN_TTL_DAYS: "-3" }).ttlS).toBe(30 * 86400);
    // Faute de frappe sur le mode : fermé, jamais ouvert.
    expect(authConfig({ AQR_SIGNUP: "oepn" }).signup).toBe("closed");
    expect(authConfig({ AQR_TRUST_PROXY: "1" }).trustProxy).toBe(true);
  });
  it("la durée maximale n'est jamais inférieure à la durée glissante", () => {
    const c = authConfig({
      AQR_LOGIN_TTL_DAYS: "90",
      AQR_LOGIN_MAX_DAYS: "10",
    });
    expect(c.maxS).toBe(c.ttlS);
  });
});

describe("inscription", () => {
  it("le premier compte est administrateur, les suivants non", async () => {
    const first = await register("Cherif");
    const second = await register("Awa");
    expect(first.ok && first.user.role).toBe("admin");
    expect(second.ok && second.user.role).toBe("user");
  });

  it("refuse un pseudonyme déjà pris, sans tenir compte de la casse", async () => {
    await register("Cherif");
    const again = await register("cherif");
    expect(again).toMatchObject({ ok: false, status: 409, field: "username" });
  });

  it("refuse une adresse e-mail et les pseudonymes invalides ou réservés", async () => {
    for (const bad of [
      "a@b.fr",
      "x",
      "a".repeat(25),
      "<script>",
      "inconnu",
      "",
    ]) {
      const result = await register(bad);
      expect(result).toMatchObject({
        ok: false,
        status: 400,
        field: "username",
      });
    }
  });

  it("refuse un mot de passe trop court, trop long ou égal au pseudonyme", async () => {
    const short = await registerAccount(
      deps(),
      { username: "Awa", password: "court" },
      "ip1",
    );
    const long = await registerAccount(
      deps(),
      { username: "Awa", password: "x".repeat(129) },
      "ip1",
    );
    const same = await registerAccount(
      deps(),
      { username: "pseudonyme-long", password: "Pseudonyme-Long" },
      "ip1",
    );
    for (const r of [short, long, same])
      expect(r).toMatchObject({ ok: false, status: 400, field: "password" });
  });

  it("refuse les types inattendus sans lever d'exception", async () => {
    const result = await registerAccount(
      deps(),
      { username: { $ne: 1 }, password: 12 },
      "ip1",
    );
    expect(result.ok).toBe(false);
  });

  it("mode fermé : refusé, sauf l'amorçage du tout premier compte", async () => {
    cfg = authConfig({ AQR_SIGNUP: "closed" });
    expect(signupStatus(deps())).toEqual({
      signup: "closed",
      setup_required: true,
    });
    expect((await register("Cherif")).ok).toBe(true);
    expect(await register("Awa")).toMatchObject({ ok: false, status: 403 });
  });

  it("mode code : exige le bon code, et se ferme si aucun code n'est configuré", async () => {
    cfg = authConfig({ AQR_SIGNUP: "code", AQR_SIGNUP_CODE: "sésame-2026" });
    expect(await register("Awa")).toMatchObject({
      ok: false,
      status: 403,
      field: "code",
    });
    expect(await register("Awa", { code: "faux" })).toMatchObject({
      ok: false,
      status: 403,
    });
    expect((await register("Awa", { code: "sésame-2026" })).ok).toBe(true);
    cfg = authConfig({ AQR_SIGNUP: "code" });
    expect(await register("Bou", { code: "" })).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("limite les inscriptions par IP et par heure", async () => {
    cfg = authConfig({ AQR_REGISTER_PER_HOUR: "2" });
    limiters = createLimiters(cfg);
    await register("Un");
    await register("Deux");
    expect(await register("Trois")).toMatchObject({ ok: false, status: 429 });
    clock += 3_600_001;
    expect((await register("Trois")).ok).toBe(true);
  });

  it("ne stocke ni le mot de passe ni le jeton en clair", async () => {
    const result = await register("Cherif");
    if (!result.ok) throw new Error("inscription attendue");
    const dump = JSON.stringify([
      db.prepare("SELECT * FROM users").all(),
      db.prepare("SELECT * FROM auth_sessions").all(),
    ]);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain(result.token);
    expect(dump).toContain(hashToken(result.token));
  });
});

describe("connexion", () => {
  beforeEach(async () => {
    await register("Cherif");
  });

  it("connecte avec le bon mot de passe (pseudonyme insensible à la casse)", async () => {
    const result = await login("CHERIF");
    expect(result.ok && result.user.username).toBe("Cherif");
  });

  it("donne le même message pour un mauvais mot de passe et un pseudonyme inconnu", async () => {
    const wrong = await login("Cherif", "pas le bon mot de passe");
    const unknown = await login("Fantome");
    expect(wrong).toMatchObject({ ok: false, status: 401 });
    expect(unknown).toMatchObject({ ok: false, status: 401 });
    expect(wrong.ok === false && wrong.message).toBe(
      unknown.ok === false && unknown.message,
    );
  });

  it("verrouille après 5 échecs, même avec le bon mot de passe, puis libère", async () => {
    for (let i = 0; i < 5; i++) await login("Cherif", "mauvais mot de passe");
    const locked = await login("Cherif");
    expect(locked).toMatchObject({ ok: false, status: 429 });
    expect(locked.ok === false && locked.retryAfterS).toBeGreaterThan(0);
    clock += 16_000;
    expect((await login("Cherif")).ok).toBe(true);
  });

  it("le verrou d'une IP ne bloque pas une autre IP", async () => {
    for (let i = 0; i < 5; i++)
      await login("Cherif", "mauvais mot de passe", "ip-mal");
    expect((await login("Cherif", PASSWORD, "ip-ami")).ok).toBe(true);
  });

  it("un balayage de pseudonymes depuis une IP finit verrouillé", async () => {
    for (let i = 0; i < 25; i++) await login(`inconnu${i}`);
    expect(await login("Cherif")).toMatchObject({ ok: false, status: 429 });
  });

  it("refuse les entrées démesurées ou de mauvais type", async () => {
    expect(await login("x".repeat(500))).toMatchObject({
      ok: false,
      status: 401,
    });
    expect(
      await loginAccount(deps(), { username: ["a"], password: {} }, "ip1"),
    ).toMatchObject({ ok: false, status: 401 });
  });
});

describe("comptes désactivés", () => {
  it("ne peut plus se connecter et perd ses connexions ouvertes", async () => {
    await register("Cherif");
    const awa = await register("Awa");
    if (!awa.ok) throw new Error("inscription attendue");
    expect(resolveLogin(db, awa.token, cfg, clock)?.username).toBe("Awa");
    updateUser(db, awa.user.id, { disabled: true });
    expect(resolveLogin(db, awa.token, cfg, clock)).toBeNull();
    expect(await login("Awa")).toMatchObject({ ok: false, status: 401 });
    updateUser(db, awa.user.id, { disabled: false });
    expect((await login("Awa")).ok).toBe(true);
  });

  it("refuse de retirer le dernier administrateur actif", async () => {
    await register("Cherif");
    expect(() => updateUser(db, 1, { role: "user" })).toThrow(/administrateur/);
    expect(() => updateUser(db, 1, { disabled: true })).toThrow(
      /administrateur/,
    );
    await register("Awa");
    expect(updateUser(db, 2, { role: "admin" })?.role).toBe("admin");
    expect(updateUser(db, 1, { role: "user" })?.role).toBe("user");
    expect(updateUser(db, 99, { role: "user" })).toBeNull();
  });
});

describe("jetons de connexion", () => {
  it("expirent, et glissent sans dépasser la durée maximale", async () => {
    await register("Cherif");
    const token = createLogin(db, 1, cfg, clock);
    const day = 86_400_000;
    // Utilisé tous les 20 jours : il glisse (30 j chaque fois) jusqu'au plafond de 180 j.
    for (let i = 1; i <= 8; i++) {
      clock += 20 * day;
      expect(resolveLogin(db, token, cfg, clock)?.username).toBe("Cherif");
    }
    clock += 20 * day; // 180 j depuis la création : plafond atteint
    expect(resolveLogin(db, token, cfg, clock)).toBeNull();
  });

  it("expire après la durée glissante sans usage", async () => {
    await register("Cherif");
    const token = createLogin(db, 1, cfg, clock);
    expect(
      resolveLogin(db, token, cfg, clock + 29 * 86_400_000),
    ).not.toBeNull();
    const idle = createLogin(db, 1, cfg, clock);
    expect(resolveLogin(db, idle, cfg, clock + 31 * 86_400_000)).toBeNull();
  });

  it("est révoqué à la déconnexion et ignore les jetons forgés", async () => {
    await register("Cherif");
    const token = createLogin(db, 1, cfg, clock);
    revokeLogin(db, token);
    expect(resolveLogin(db, token, cfg, clock)).toBeNull();
    expect(resolveLogin(db, newToken(), cfg, clock)).toBeNull();
    expect(resolveLogin(db, "' OR 1=1 --", cfg, clock)).toBeNull();
  });

  it("a 256 bits d'entropie et des valeurs uniques", () => {
    const a = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newToken()).not.toBe(a);
  });
});

describe("changement de mot de passe", () => {
  it("exige l'ancien, applique le nouveau et révoque les autres connexions", async () => {
    const reg = await register("Cherif");
    if (!reg.ok) throw new Error("inscription attendue");
    const other = createLogin(db, reg.user.id, cfg, clock);
    const wrong = await changePassword(
      deps(),
      reg.user,
      reg.token,
      { current: "faux faux faux", next: "nouveau mot de passe 1" },
      "ip1",
    );
    expect(wrong).toMatchObject({ ok: false, status: 401 });
    const weak = await changePassword(
      deps(),
      reg.user,
      reg.token,
      { current: PASSWORD, next: "court" },
      "ip1",
    );
    expect(weak).toMatchObject({ ok: false, status: 400 });
    const done = await changePassword(
      deps(),
      reg.user,
      reg.token,
      { current: PASSWORD, next: "nouveau mot de passe 1" },
      "ip1",
    );
    expect(done).toEqual({ ok: true });
    expect(resolveLogin(db, other, cfg, clock)).toBeNull();
    expect(resolveLogin(db, reg.token, cfg, clock)).not.toBeNull();
    expect((await login("Cherif")).ok).toBe(false);
    expect((await login("Cherif", "nouveau mot de passe 1")).ok).toBe(true);
  });
});

describe("cookie", () => {
  it("est HttpOnly, SameSite=Lax, Secure seulement en HTTPS", () => {
    const token = newToken();
    const http = loginCookie(token, 100, false);
    const https = loginCookie(token, 100, true);
    expect(http).toContain("HttpOnly");
    expect(http).toContain("SameSite=Lax");
    expect(http).toContain("Path=/");
    expect(http).not.toContain("Secure");
    expect(https).toContain("; Secure");
    expect(clearedCookie(true)).toContain("Max-Age=0");
  });

  it("n'accepte qu'un jeton bien formé", () => {
    const token = newToken();
    expect(sessionToken(`a=1; aqr_session=${token}; b=2`)).toBe(token);
    expect(sessionToken("aqr_session=court")).toBeNull();
    expect(sessionToken("aqr_session='; DROP TABLE users;--")).toBeNull();
    expect(sessionToken(null)).toBeNull();
    expect(readCookie("x=1; y=2", "y")).toBe("2");
  });
});

describe("politique de mot de passe à l'inscription et au changement", () => {
  it("refuse un mot de passe courant ou trop court", async () => {
    const weak = await registerAccount(
      deps(),
      { username: "fatou", password: "password1234" },
      "ip1",
    );
    expect(weak.ok).toBe(false);
    if (!weak.ok) {
      expect(weak.status).toBe(400);
      expect(weak.field).toBe("password");
      expect(weak.message).toMatch(/courant|prévisible/);
    }
    const short = await registerAccount(
      deps(),
      { username: "fatou", password: "Court-123" },
      "ip1",
    );
    expect(short.ok).toBe(false);
  });
  it("refuse, au changement, un mot de passe contenant le pseudonyme", async () => {
    const created = await register("moussa_diallo");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const result = await changePassword(
      deps(),
      created.user,
      created.token,
      { current: PASSWORD, next: "moussa_diallo-2026-ok" },
      "ip1",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/pseudonyme/);
  });
});

describe("empreinte refaite à la connexion", () => {
  it("une empreinte plus faible que le réglage courant est remplacée", async () => {
    const { hashPassword } = await import("./passwords");
    const { setPasswordHash, findUserRow } = await import("./users");
    const created = await register("awa");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const weak = await hashPassword(PASSWORD, { N: 1024, r: 8, p: 1 });
    setPasswordHash(db, created.user.id, weak);
    expect((await login("awa")).ok).toBe(true);
    const after = findUserRow(db, "awa")?.password_hash ?? "";
    expect(after).not.toBe(weak);
    expect(after.split("$")[1]).toBe(String(2 ** 12)); // réglage de la suite de tests
  });
});

describe("limitation par compte, toutes adresses confondues", () => {
  it("une attaque répartie sur 12 adresses verrouille le compte, pas les autres", async () => {
    await register("awa");
    await register("bakary");
    for (let i = 0; i < 12; i++)
      await login("awa", "mauvais mot de passe", `203.0.113.${i}`);
    const locked = await login("awa", PASSWORD, "198.51.100.1");
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.status).toBe(429);
      expect(locked.retryAfterS ?? 0).toBeLessThanOrEqual(120);
    }
    // un autre compte, depuis une autre adresse, n'est pas touché
    expect((await login("bakary", PASSWORD, "198.51.100.2")).ok).toBe(true);
  });
  it("le verrou du compte est plafonné à 2 minutes puis tombe tout seul", async () => {
    await register("awa");
    for (let i = 0; i < 40; i++)
      await login("awa", "mauvais mot de passe", `203.0.113.${i % 20}`);
    clock += 2 * 60 * 1000 + 1000;
    expect((await login("awa", PASSWORD, "198.51.100.9")).ok).toBe(true);
  });
  it("un administrateur lève le verrou d'un compte", async () => {
    const { unlockAccount } = await import("./auth");
    await register("awa");
    for (let i = 0; i < 12; i++)
      await login("awa", "mauvais mot de passe", `203.0.113.${i}`);
    expect((await login("awa", PASSWORD, "198.51.100.1")).ok).toBe(false);
    unlockAccount(deps(), "awa");
    expect((await login("awa", PASSWORD, "198.51.100.1")).ok).toBe(true);
  });
});

describe("verrouillage persistant", () => {
  it("survit à un redémarrage : de nouveaux limiteurs sur la même base refusent encore", async () => {
    limiters = createLimiters(cfg, db);
    await register("awa");
    for (let i = 0; i < 6; i++) await login("awa", "mauvais mot de passe");
    const restarted = createLimiters(cfg, db); // « redémarrage » du serveur
    limiters = restarted;
    const result = await login("awa", PASSWORD);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(429);
  });
});

describe("journal des connexions", () => {
  it("consigne succès, échec et verrouillage, sans mot de passe", async () => {
    const { vi } = await import("vitest");
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await register("awa");
    await login("awa", "mauvais mot de passe");
    await login("awa");
    for (let i = 0; i < 6; i++) await login("awa", "mauvais mot de passe");
    await login("awa");
    const lines = spy.mock.calls.map((call) => String(call[0]));
    spy.mockRestore();
    const events = lines
      .filter((line) => line.includes(" audit: "))
      .map((line) => JSON.parse(line.slice(line.indexOf("{"))).event);
    expect(events).toEqual(
      expect.arrayContaining([
        "register",
        "login.failure",
        "login.success",
        "login.locked",
      ]),
    );
    const everything = lines.join("\n");
    expect(everything).not.toContain("mauvais mot de passe");
    expect(everything).not.toContain(PASSWORD);
  });
  it("consigne un changement de mot de passe réussi et un échec", async () => {
    const { vi } = await import("vitest");
    const created = await register("awa");
    if (!created.ok) throw new Error("inscription");
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await changePassword(
      deps(),
      created.user,
      created.token,
      { current: "faux faux faux", next: "autre phrase de passe 2027" },
      "ip1",
    );
    await changePassword(
      deps(),
      created.user,
      created.token,
      { current: PASSWORD, next: "autre phrase de passe 2027" },
      "ip1",
    );
    const events = spy.mock.calls
      .map((call) => String(call[0]))
      .filter((line) => line.includes(" audit: "))
      .map((line) => JSON.parse(line.slice(line.indexOf("{"))).event);
    spy.mockRestore();
    expect(events).toEqual(["password.change_failed", "password.change"]);
  });
});
