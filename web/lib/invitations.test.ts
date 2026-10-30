import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./db";
import {
  INVITATION_PREFIX,
  MAX_ACTIVE_INVITATIONS,
  InvitationLimitError,
  cleanInvitationLabel,
  consumeInvitation,
  createInvitation,
  invitationState,
  listInvitations,
  looksLikeInvitation,
  passesGate,
  revokeInvitation,
} from "./invitations";

/**
 * Invitations de testeurs : un lien qui ouvre l'accès à l'atelier (comme le jeton d'accès, mais propre à une
 * personne, révocable et limité dans le temps) et autorise un nombre limité d'inscriptions. Le jeton clair n'existe
 * qu'à la création ; la base ne garde que son empreinte.
 */
let tmp = "";
let db: Db;
let adminId = 0;
const NOW = new Date("2026-10-30T15:00:00.000Z");
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000);

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-invit-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
  const { getDb } = await import("./db");
  const { createUser } = await import("./users");
  db = getDb();
  adminId = createUser(db, { username: "admin1", passwordHash: "x" }).id;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("./db");
  closeDb();
  await rm(tmp, { recursive: true, force: true });
});

const make = (over: Partial<Parameters<typeof createInvitation>[1]> = {}) =>
  createInvitation(db, { label: "Aminata", createdBy: adminId, ...over }, NOW);

describe("création", () => {
  it("rend un jeton inv_ de 128 bits, montré une seule fois ; la base ne garde que son empreinte", () => {
    const { token, row } = make();
    expect(token).toMatch(/^inv_[A-Za-z0-9_-]{22}$/);
    expect(looksLikeInvitation(token)).toBe(true);
    expect(row).toMatchObject({
      label: "Aminata",
      uses: 0,
      max_uses: 1,
      revoked_at: null,
    });
    expect(row.prefix).toBe(
      token.slice(INVITATION_PREFIX.length, INVITATION_PREFIX.length + 6),
    );
    const stored = JSON.stringify(
      db.prepare("SELECT * FROM invitations").all(),
    );
    expect(stored).not.toContain(token);
    expect(JSON.stringify(listInvitations(db))).not.toContain("token_hash");
  });

  it("valeurs par défaut : 1 inscription, 14 jours", () => {
    const { row } = make();
    expect(row.max_uses).toBe(1);
    expect(Date.parse(row.expires_at) - NOW.getTime()).toBe(14 * 86_400_000);
  });

  it("bornes : durée 1 à 90 jours, 1 à 20 inscriptions ; hors bornes, valeur ramenée dans la plage", () => {
    expect(make({ expiresInDays: 0 }).row.expires_at).toBe(
      later(1).toISOString(),
    );
    expect(make({ expiresInDays: 999 }).row.expires_at).toBe(
      later(90).toISOString(),
    );
    expect(make({ maxUses: 0 }).row.max_uses).toBe(1);
    expect(make({ maxUses: 500 }).row.max_uses).toBe(20);
  });

  it("deux invitations ont deux jetons différents", () => {
    expect(make().token).not.toBe(make().token);
  });

  it("nombre d'invitations actives borné", () => {
    for (let i = 0; i < MAX_ACTIVE_INVITATIONS; i++) make();
    expect(() => make()).toThrow(InvitationLimitError);
    // Une invitation révoquée libère une place.
    revokeInvitation(db, listInvitations(db)[0].id, NOW);
    expect(() => make()).not.toThrow();
  });

  it("nom : nettoyé, 1 à 60 caractères", () => {
    expect(cleanInvitationLabel("  Fatou   Sow ")).toBe("Fatou Sow");
    expect(cleanInvitationLabel("")).toBeNull();
    expect(cleanInvitationLabel("x".repeat(61))).toBeNull();
    expect(cleanInvitationLabel(42)).toBeNull();
  });
});

describe("accès à l'atelier par le lien (la barrière)", () => {
  it("un lien valide ouvre l'accès, avant et après avoir servi à une inscription", () => {
    const { token } = make();
    expect(passesGate(db, token, NOW)).toBe(true);
    expect(consumeInvitation(db, token, NOW)).toBe(true); // inscription faite : épuisée
    // Un testeur qui revient plus tard doit pouvoir rouvrir le même lien pour se connecter.
    expect(passesGate(db, token, later(3))).toBe(true);
  });

  it("refusé après expiration, après révocation, pour un jeton inconnu ou mal formé", () => {
    const { token, row } = make({ expiresInDays: 2 });
    expect(passesGate(db, token, later(1))).toBe(true);
    expect(passesGate(db, token, later(2))).toBe(false); // à l'instant exact : expiré
    expect(passesGate(db, token, later(30))).toBe(false);
    const other = make().token;
    expect(passesGate(db, other, NOW)).toBe(true);
    revokeInvitation(
      db,
      listInvitations(db).find((r) => r.id !== row.id)!.id,
      NOW,
    );
    expect(passesGate(db, other, NOW)).toBe(false);
    for (const bad of [
      "",
      "inv_",
      "inv_court",
      "qtr_" + "A".repeat(43),
      `inv_${"A".repeat(22)}x`,
      null,
      undefined,
      3,
    ])
      expect(passesGate(db, bad as string, NOW), String(bad)).toBe(false);
  });
});

describe("inscription : consommation", () => {
  it("chaque inscription consomme une place, jamais plus que max_uses", () => {
    const { token } = make({ maxUses: 2 });
    expect(consumeInvitation(db, token, NOW)).toBe(true);
    expect(consumeInvitation(db, token, NOW)).toBe(true);
    expect(consumeInvitation(db, token, NOW)).toBe(false); // épuisée
    expect(listInvitations(db)[0].uses).toBe(2);
    expect(invitationState(listInvitations(db)[0], NOW)).toBe("used_up");
  });

  it("refusée si expirée ou révoquée, sans rien consommer", () => {
    const { token, row } = make({ expiresInDays: 1 });
    expect(consumeInvitation(db, token, later(5))).toBe(false);
    expect(listInvitations(db)[0].uses).toBe(0);
    revokeInvitation(db, row.id, NOW);
    expect(consumeInvitation(db, token, NOW)).toBe(false);
  });

  it("la dernière place ne peut être prise qu'une fois, même en rafale", () => {
    const { token } = make({ maxUses: 1 });
    const results = Array.from({ length: 10 }, () =>
      consumeInvitation(db, token, NOW),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("jeton inconnu : faux, rien n'est écrit", () => {
    expect(consumeInvitation(db, "inv_" + "A".repeat(22), NOW)).toBe(false);
  });
});

describe("état et révocation", () => {
  it("états lisibles", () => {
    const { token, row } = make({ maxUses: 1, expiresInDays: 5 });
    expect(invitationState(row, NOW)).toBe("active");
    expect(invitationState(row, later(6))).toBe("expired");
    consumeInvitation(db, token, NOW);
    expect(invitationState(listInvitations(db)[0], NOW)).toBe("used_up");
    revokeInvitation(db, row.id, NOW);
    expect(invitationState(listInvitations(db)[0], NOW)).toBe("revoked");
  });

  it("révoquer deux fois ou une invitation inconnue : faux", () => {
    const { row } = make();
    expect(revokeInvitation(db, row.id, NOW)).toBe(true);
    expect(revokeInvitation(db, row.id, NOW)).toBe(false);
    expect(revokeInvitation(db, 9999, NOW)).toBe(false);
  });
});
