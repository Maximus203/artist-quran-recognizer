import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  authConfig,
  createLimiters,
  registerAccount,
  type AuthDeps,
} from "./auth";
import { closeDb, getDb } from "./db";
import { codeRequired } from "./signup-code";

/**
 * Le formulaire d'inscription et le serveur doivent s'accorder : en mode « code », le serveur exige le code
 * pour TOUT le monde, premier compte compris. Le formulaire cachait ce champ au premier inscrit (« setup ») :
 * le premier compte d'un atelier en mode « code » était impossible à créer par l'interface.
 */
let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-signup-"));
  process.env.AQR_REVIEW_DIR = dir;
});
afterEach(async () => {
  closeDb();
  delete process.env.AQR_REVIEW_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("code d'invitation et premier compte", () => {
  it("le formulaire demande le code en mode code, même pour le premier compte", () => {
    expect(codeRequired("code", true)).toBe(true);
    expect(codeRequired("code", false)).toBe(true);
  });

  it("les autres modes ne demandent aucun code", () => {
    expect(codeRequired("open", true)).toBe(false);
    expect(codeRequired("open", false)).toBe(false);
    expect(codeRequired("closed", true)).toBe(false);
    expect(codeRequired("closed", false)).toBe(false);
  });

  it("le serveur refuse bien le premier compte sans code en mode code (règle que le formulaire doit respecter)", async () => {
    const cfg = authConfig({
      AQR_SIGNUP: "code",
      AQR_SIGNUP_CODE: "sésame-2026-ok",
    });
    const db = getDb();
    const deps: AuthDeps = { db, cfg, limiters: createLimiters(cfg, db) };
    const credentials = {
      username: "Awa",
      password: "Gamma-Orchidee-7391-pluie",
    };
    expect(await registerAccount(deps, credentials, "local")).toMatchObject({
      ok: false,
      status: 403,
      field: "code",
    });
    const accepted = await registerAccount(
      deps,
      { ...credentials, code: "sésame-2026-ok" },
      "local",
    );
    expect(accepted.ok).toBe(true);
  });
});
