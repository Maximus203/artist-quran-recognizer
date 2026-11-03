import { describe, expect, it } from "vitest";
import {
  SCRYPT_MIN_LOG_N,
  scryptParams,
  hashPassword,
  needsRehash,
  verifyAgainstDummy,
  verifyPassword,
} from "./passwords";

// Coût réduit : le test vérifie la logique, pas la robustesse du réglage de production.
const FAST = { N: 1024, r: 8, p: 1 };

describe("coût scrypt", () => {
  it("par défaut : N = 2^17, r = 8, p = 1 (OWASP)", () => {
    expect(scryptParams({})).toEqual({ N: 131072, r: 8, p: 1 });
    expect(SCRYPT_MIN_LOG_N).toBe(17);
  });
  it("AQR_SCRYPT_LOG_N hors de 12 à 20, ou illisible : ignoré", () => {
    expect(scryptParams({ AQR_SCRYPT_LOG_N: "10" }).N).toBe(2 ** 17);
    expect(scryptParams({ AQR_SCRYPT_LOG_N: "25" }).N).toBe(2 ** 17);
    expect(scryptParams({ AQR_SCRYPT_LOG_N: "abc" }).N).toBe(2 ** 17);
    expect(scryptParams({ AQR_SCRYPT_LOG_N: "12" }).N).toBe(2 ** 12);
  });
  it("une empreinte de l'ancien réglage (2^15, p = 1) est à refaire", async () => {
    const old = await hashPassword("ancienne-phrase-de-passe", {
      N: 2 ** 15,
      r: 8,
      p: 1,
    });
    expect(needsRehash(old, scryptParams({}))).toBe(true);
    expect(needsRehash(old, { N: 2 ** 15, r: 8, p: 1 })).toBe(false);
  });
});

describe("mots de passe (scrypt)", () => {
  it("vérifie le bon mot de passe et refuse les autres", async () => {
    const stored = await hashPassword("un bon mot de passe", FAST);
    expect(await verifyPassword("un bon mot de passe", stored)).toBe(true);
    expect(await verifyPassword("un bon mot de passe ", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("sale chaque empreinte et porte ses paramètres", async () => {
    const a = await hashPassword("même secret 1234", FAST);
    const b = await hashPassword("même secret 1234", FAST);
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$1024$8$1$")).toBe(true);
  });

  it("ne contient jamais le mot de passe en clair", async () => {
    const stored = await hashPassword("secret-très-visible", FAST);
    expect(stored).not.toContain("secret-très-visible");
  });

  it("refuse sans lever d'exception les empreintes malformées ou hors bornes", async () => {
    for (const bad of [
      "",
      "plain",
      "scrypt$1024$8$1$abc",
      "scrypt$3$8$1$c2FsdHNhbHRzYWx0$a2V5a2V5a2V5a2V5a2V5",
      "scrypt$99999999$8$1$c2FsdHNhbHRzYWx0$a2V5a2V5a2V5a2V5a2V5",
      "scrypt$1024$8$99$c2FsdHNhbHRzYWx0$a2V5a2V5a2V5a2V5a2V5",
      "argon2$1024$8$1$c2FsdHNhbHRzYWx0$a2V5a2V5a2V5a2V5a2V5",
    ])
      expect(await verifyPassword("x", bad)).toBe(false);
  });

  it("normalise l'Unicode (NFKC) : « é » composé = « é » décomposé", async () => {
    const stored = await hashPassword("café-secret-1", FAST);
    expect(await verifyPassword("café-secret-1", stored)).toBe(true);
  });

  it("signale les empreintes plus faibles que les paramètres courants", async () => {
    const weak = await hashPassword("x".repeat(12), FAST);
    expect(needsRehash(weak)).toBe(true);
    expect(needsRehash(weak, FAST)).toBe(false);
    expect(needsRehash("n'importe quoi")).toBe(true);
  });

  it("refuse toujours le faux compte (connexion à pseudonyme inconnu)", async () => {
    expect(await verifyAgainstDummy("quelconque")).toBe(false);
  });
});
