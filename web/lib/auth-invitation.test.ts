import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  authConfig,
  createLimiters,
  registerAccount,
  type AuthConfig,
  type AuthDeps,
} from "./auth";
import { openDatabase, type Db } from "./db";
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
} from "./invitations";
import { countUsers, createUser } from "./users";

/**
 * Inscription par invitation : le lien d'invitation, passé comme code, ouvre l'inscription même en mode « code »
 * ou « fermé », consomme UNE place avec la création du compte, et n'est jamais consommé par un échec.
 */
const PASSWORD = "mot de passe correct 42";
let db: Db;
let cfg: AuthConfig;
let clock: number;
let adminId = 0;

const deps = (): AuthDeps => ({
  db,
  cfg,
  limiters: createLimiters(cfg),
  now: () => clock,
});
beforeEach(() => {
  db = openDatabase(":memory:");
  clock = Date.UTC(2026, 9, 30, 15, 0, 0);
  cfg = authConfig({ AQR_SIGNUP: "code", AQR_SIGNUP_CODE: "sésame-2026-ok" });
  adminId = createUser(db, { username: "Cherif", passwordHash: "x" }).id;
});
afterEach(() => db.close());

const invite = (
  over: Parameters<typeof createInvitation>[1] extends infer T
    ? Partial<T>
    : never = {},
) =>
  createInvitation(
    db,
    { label: "Aminata", createdBy: adminId, ...over },
    new Date(clock),
  );
const register = (username: string, code?: string) =>
  registerAccount(
    deps(),
    { username, password: PASSWORD, code },
    `ip-${username}`,
  );

describe("mode code", () => {
  it("une invitation valide tient lieu de code et crée le compte", async () => {
    const { token } = invite();
    const result = await register("Aminata", token);
    expect(result.ok).toBe(true);
    expect(countUsers(db)).toBe(2);
  });

  it("le code du serveur marche toujours (clé de secours de l'administrateur)", async () => {
    expect((await register("Awa", "sésame-2026-ok")).ok).toBe(true);
  });

  it("une invitation épuisée, expirée ou révoquée est refusée comme un faux code", async () => {
    const used = invite({ maxUses: 1 });
    expect((await register("Un", used.token)).ok).toBe(true);
    expect(await register("Deux", used.token)).toMatchObject({
      ok: false,
      status: 403,
      field: "code",
    });
    const revoked = invite();
    revokeInvitation(db, revoked.row.id, new Date(clock));
    expect(await register("Trois", revoked.token)).toMatchObject({
      ok: false,
      status: 403,
    });
    const expired = invite({ expiresInDays: 1 });
    clock += 2 * 86_400_000;
    expect(await register("Quatre", expired.token)).toMatchObject({
      ok: false,
      status: 403,
    });
  });

  it("un jeton qui ressemble à une invitation mais n'existe pas est refusé", async () => {
    expect(await register("Faux", "inv_" + "A".repeat(22))).toMatchObject({
      ok: false,
      status: 403,
    });
  });
});

describe("mode fermé", () => {
  it("une invitation ouvre l'inscription que le mode fermé refuse aux autres", async () => {
    cfg = authConfig({ AQR_SIGNUP: "closed" });
    expect(await register("Sans")).toMatchObject({ ok: false, status: 403 });
    const { token } = invite();
    expect((await register("Avec", token)).ok).toBe(true);
  });
});

describe("mode ouvert", () => {
  it("n'a pas besoin d'invitation et ne la consomme pas", async () => {
    cfg = authConfig({ AQR_SIGNUP: "open" });
    const { token } = invite();
    expect((await register("Libre", token)).ok).toBe(true);
    expect(listInvitations(db)[0].uses).toBe(0);
  });
});

describe("consommation", () => {
  it("une place consommée par compte créé, jamais plus que le plafond", async () => {
    const { token } = invite({ maxUses: 2 });
    expect((await register("A1", token)).ok).toBe(true);
    expect((await register("A2", token)).ok).toBe(true);
    expect((await register("A3", token)).ok).toBe(false);
    expect(listInvitations(db)[0].uses).toBe(2);
  });

  it("un échec d'inscription ne consomme rien (pseudonyme pris, mot de passe refusé)", async () => {
    const { token } = invite({ maxUses: 1 });
    expect((await register("Cherif", token)).ok).toBe(false); // pseudonyme déjà pris
    expect(
      (
        await registerAccount(
          deps(),
          { username: "Neuf", password: "court", code: token },
          "ip-x",
        )
      ).ok,
    ).toBe(false);
    expect(listInvitations(db)[0].uses).toBe(0);
    expect((await register("Neuf", token)).ok).toBe(true); // la place est toujours là
  });

  it("deux inscriptions simultanées sur la dernière place : un seul compte naît", async () => {
    const { token } = invite({ maxUses: 1 });
    const before = countUsers(db);
    const results = await Promise.all([
      register("Course1", token),
      register("Course2", token),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(countUsers(db) - before).toBe(1);
    expect(listInvitations(db)[0].uses).toBe(1);
  });
});
