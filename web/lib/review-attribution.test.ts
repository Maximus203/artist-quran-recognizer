import { describe, expect, it } from "vitest";
import { newAnnotation, type Annotation } from "./review";
import { attribute } from "./review-update";

const NOW = "2026-10-22T10:00:00.000Z";
const make = (tester: string, id: string, over: Partial<Annotation> = {}) => ({
  ...newAnnotation({ tester, start: 1, end: null, id, now: NOW }),
  ...over,
});
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const awa = { username: "Awa", admin: false };
const root = { username: "Cherif", admin: true };

describe("attribution des signalements au compte", () => {
  it("un nouveau signalement appartient au compte, quoi que prétende le client", () => {
    const out = attribute(
      [],
      [make("Usurpateur", A, { updated_by: "Autre" })],
      [],
      awa,
    );
    expect(out.annotations).toHaveLength(1);
    expect(out.annotations[0].tester).toBe("Awa");
    expect(out.annotations[0].updated_by).toBeUndefined();
    expect(out.rejected).toEqual([]);
  });

  it("le propriétaire modifie le sien, sans updated_by", () => {
    const mine = make("Awa", A);
    const out = attribute(
      [mine],
      [{ ...mine, description: "corrigé" }],
      [],
      awa,
    );
    expect(out.annotations[0]).toMatchObject({
      tester: "Awa",
      description: "corrigé",
    });
    expect(out.annotations[0].updated_by).toBeUndefined();
  });

  it("refuse de modifier ou supprimer le signalement d'un autre testeur", () => {
    const theirs = make("Bou", A);
    const out = attribute(
      [theirs],
      [{ ...theirs, description: "piraté" }],
      [A],
      awa,
    );
    expect(out.annotations).toEqual([]);
    expect(out.deletedIds).toEqual([]);
    expect(out.rejected).toEqual([A]);
  });

  it("un administrateur modifie celui d'un autre : l'auteur reste, updated_by le dit", () => {
    const theirs = make("Bou", A);
    const out = attribute(
      [theirs],
      [{ ...theirs, description: "relu" }],
      [],
      root,
    );
    expect(out.annotations[0]).toMatchObject({
      tester: "Bou",
      updated_by: "Cherif",
    });
    expect(out.rejected).toEqual([]);
  });

  it("l'administrateur peut supprimer ; supprimer un identifiant inconnu est inoffensif", () => {
    const theirs = make("Bou", A);
    const out = attribute([theirs], [], [A, C], root);
    expect(out.deletedIds).toEqual([A, C]);
    expect(attribute([theirs], [], [C], awa).deletedIds).toEqual([C]);
  });

  it("un signalement d'avant les comptes (« inconnu ») est réservé aux administrateurs", () => {
    const legacy = make("inconnu", B);
    expect(attribute([legacy], [legacy], [], awa).rejected).toEqual([B]);
    expect(attribute([legacy], [legacy], [], root).rejected).toEqual([]);
  });

  it("mélange : les siens passent, ceux des autres sont refusés une seule fois", () => {
    const mine = make("Awa", A);
    const theirs = make("Bou", B);
    const out = attribute(
      [mine, theirs],
      [mine, theirs, make("x", C)],
      [B],
      awa,
    );
    expect(out.annotations.map((a) => a.id).sort()).toEqual([A, C].sort());
    expect(out.rejected).toEqual([B]);
  });
});
