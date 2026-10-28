import { describe, expect, it } from "vitest";
import {
  bearerApiToken,
  cleanTokenName,
  createApiToken,
  listApiTokens,
  looksLikeApiToken,
  MAX_TOKENS_PER_USER,
  resolveApiToken,
  revokeApiToken,
  TokenLimitError,
  tokenMayCall,
} from "./api-tokens";
import { openDatabase } from "./db";
import { createUser } from "./users";

function fixture() {
  const db = openDatabase(":memory:");
  const user = createUser(db, { username: "awa", passwordHash: "x" });
  return { db, user };
}

describe("jetons d'API", () => {
  it("génère un jeton de forme fixe et ne garde que son empreinte", () => {
    const { db, user } = fixture();
    const { token, row } = createApiToken(db, {
      userId: user.id,
      name: "Mon agent",
      scope: "read",
    });
    expect(looksLikeApiToken(token)).toBe(true);
    expect(row.prefix).toBe(token.slice(4, 12));
    const stored = db.prepare("SELECT * FROM api_tokens").get();
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it("reconnaît un jeton valide et le rattache à son compte", () => {
    const { db, user } = fixture();
    const { token } = createApiToken(db, {
      userId: user.id,
      name: "n",
      scope: "write",
    });
    const identity = resolveApiToken(db, token);
    expect(identity?.user.id).toBe(user.id);
    expect(identity?.token.scope).toBe("write");
    expect(resolveApiToken(db, token + "x")).toBeNull();
    expect(resolveApiToken(db, "qtr_" + "a".repeat(43))).toBeNull();
  });

  it("refuse un jeton révoqué, expiré ou d'un compte désactivé", () => {
    const { db, user } = fixture();
    const a = createApiToken(db, { userId: user.id, name: "a", scope: "read" });
    expect(revokeApiToken(db, user.id, a.row.id)).toBe(true);
    expect(revokeApiToken(db, user.id, a.row.id)).toBe(false);
    expect(resolveApiToken(db, a.token)).toBeNull();

    const b = createApiToken(db, {
      userId: user.id,
      name: "b",
      scope: "read",
      expiresInDays: 1,
    });
    expect(resolveApiToken(db, b.token)).not.toBeNull();
    expect(
      resolveApiToken(db, b.token, Date.now() + 2 * 86_400_000),
    ).toBeNull();

    const c = createApiToken(db, { userId: user.id, name: "c", scope: "read" });
    db.prepare("UPDATE users SET disabled_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      user.id,
    );
    expect(resolveApiToken(db, c.token)).toBeNull();
  });

  it("ne révoque jamais le jeton d'un autre compte", () => {
    const { db, user } = fixture();
    const other = createUser(db, { username: "moussa", passwordHash: "x" });
    const t = createApiToken(db, { userId: user.id, name: "a", scope: "read" });
    expect(revokeApiToken(db, other.id, t.row.id)).toBe(false);
    expect(resolveApiToken(db, t.token)).not.toBeNull();
    expect(listApiTokens(db, other.id)).toHaveLength(0);
  });

  it("limite le nombre de jetons actifs", () => {
    const { db, user } = fixture();
    for (let i = 0; i < MAX_TOKENS_PER_USER; i++)
      createApiToken(db, { userId: user.id, name: `t${i}`, scope: "read" });
    expect(() =>
      createApiToken(db, { userId: user.id, name: "de trop", scope: "read" }),
    ).toThrow(TokenLimitError);
  });

  it("valide le nom", () => {
    expect(cleanTokenName("  Mon   agent ")).toBe("Mon agent");
    expect(cleanTokenName("")).toBeNull();
    expect(cleanTokenName("x".repeat(61))).toBeNull();
    expect(cleanTokenName(3)).toBeNull();
  });

  it("lit le jeton dans l'en-tête Authorization", () => {
    const token = "qtr_" + "A".repeat(43);
    const req = (v: string) =>
      new Request("http://127.0.0.1/", { headers: { authorization: v } });
    expect(bearerApiToken(req(`Bearer ${token}`))).toBe(token);
    expect(bearerApiToken(req("Bearer autre-chose"))).toBeNull();
    expect(bearerApiToken(new Request("http://127.0.0.1/"))).toBeNull();
  });

  it("ne laisse un jeton toucher que les essais, et une clé en lecture ne pas écrire", () => {
    expect(tokenMayCall("read", "GET", "/api/sessions")).toBe(true);
    expect(tokenMayCall("read", "POST", "/api/sessions")).toBe(false);
    expect(tokenMayCall("write", "POST", "/api/sessions/abc/start")).toBe(true);
    expect(tokenMayCall("write", "DELETE", "/api/v1/recordings/abc")).toBe(
      true,
    );
    expect(tokenMayCall("read", "POST", "/api/mcp")).toBe(true);
    for (const forbidden of [
      "/api/me/tokens",
      "/api/me/password",
      "/api/admin/users",
      "/api/users",
      "/api/auth/logout",
    ])
      expect(tokenMayCall("write", "POST", forbidden)).toBe(false);
  });
});
