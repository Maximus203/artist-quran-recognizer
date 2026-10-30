import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Barrière d'accès : le jeton d'accès du serveur ET un lien d'invitation valide donnent le même cookie signé ;
 * un lien expiré, révoqué ou inventé ne donne rien.
 */
const SERVER_TOKEN = "t".repeat(40);
const ORIGIN = "https://atelier.example";
let tmp = "";
let POST: typeof import("./route").POST;
let create: (over?: { maxUses?: number; expiresInDays?: number }) => {
  token: string;
  id: number;
};
let revoke: (id: number) => void;
let consume: (token: string) => void;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-access-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
  vi.stubEnv("AQR_ACCESS_TOKEN", SERVER_TOKEN);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const inv = await import("@/lib/invitations");
  const db = getDb();
  const admin = createUser(db, { username: "admin1", passwordHash: "x" });
  create = (over = {}) => {
    const made = inv.createInvitation(db, {
      label: "Aminata",
      createdBy: admin.id,
      ...over,
    });
    return { token: made.token, id: made.row.id };
  };
  revoke = (id) => void inv.revokeInvitation(db, id);
  consume = (token) => void inv.consumeInvitation(db, token);
  ({ POST } = await import("./route"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(tmp, { recursive: true, force: true });
});

const post = (fields: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return POST(
    new Request(`${ORIGIN}/api/access`, { method: "POST", body: form }),
  );
};
const cookieOf = (res: Response) =>
  /aqr_access=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? null;
const grants = async (cookie: string | null) => {
  if (!cookie) return false;
  const { hasAccessCredential } = await import("@/lib/local-request");
  return hasAccessCredential(
    new Request(`${ORIGIN}/`, { headers: { cookie: `aqr_access=${cookie}` } }),
  );
};

describe("jeton d'accès du serveur (comportement existant)", () => {
  it("le bon jeton donne le cookie et renvoie vers l'accueil", async () => {
    const res = await post({ token: SERVER_TOKEN });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(await grants(cookieOf(res))).toBe(true);
  });

  it("un faux jeton : retour à la page d'accès, aucun cookie", async () => {
    const res = await post({ token: "faux" });
    expect(res.headers.get("location")).toBe("/access?error=1");
    expect(cookieOf(res)).toBeNull();
  });
});

describe("lien d'invitation", () => {
  it("un lien valide donne le même cookie et mène à l'inscription, invitation préremplie", async () => {
    const { token } = create();
    const res = await post({ invitation: token });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/register?invitation=${token}`);
    expect(await grants(cookieOf(res))).toBe(true);
    expect(res.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(res.headers.get("set-cookie")).toMatch(/SameSite=Strict/);
    expect(res.headers.get("set-cookie")).toMatch(/Secure/);
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("un lien déjà utilisé pour s'inscrire ouvre quand même l'accès, et mène à la connexion", async () => {
    const { token } = create({ maxUses: 1 });
    consume(token);
    const res = await post({ invitation: token });
    expect(await grants(cookieOf(res))).toBe(true);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("révoqué, expiré, inventé, mal formé : refusé, aucun cookie", async () => {
    const revoked = create();
    revoke(revoked.id);
    const attempts = [
      revoked.token,
      "inv_" + "A".repeat(22),
      "inv_court",
      "n'importe quoi",
      SERVER_TOKEN, // le jeton du serveur n'est pas une invitation
    ];
    for (const invitation of attempts) {
      const res = await post({ invitation });
      expect(res.headers.get("location"), invitation).toBe("/access?error=1");
      expect(cookieOf(res), invitation).toBeNull();
    }
  });

  it("un lien expiré est refusé", async () => {
    const { token } = create({ expiresInDays: 1 });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 86_400_000);
    try {
      const res = await post({ invitation: token });
      expect(cookieOf(res)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("un lien d'invitation ne remplace pas le jeton quand les deux champs sont faux", async () => {
    const res = await post({
      token: "faux",
      invitation: "inv_" + "B".repeat(22),
    });
    expect(cookieOf(res)).toBeNull();
  });
});

describe("sans jeton d'accès configuré", () => {
  it("l'atelier n'est pas protégé : un lien d'invitation ne crée aucun cookie", async () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", "");
    const { token } = create();
    const res = await post({ invitation: token });
    expect(res.headers.get("location")).toBe("/");
    expect(cookieOf(res)).toBeNull();
  });
});
