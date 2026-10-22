import { describe, expect, it } from "vitest";
import {
  can,
  canView,
  decide,
  type Ability,
  type Actor,
  type Resource,
} from "./access";

const admin: Actor = { id: 1, role: "admin" };
const owner: Actor = { id: 2, role: "user" };
const other: Actor = { id: 3, role: "user" };

const globalOwned: Resource = { owner_id: 2, visibility: "global" };
const privateOwned: Resource = { owner_id: 2, visibility: "private" };
const globalLegacy: Resource = { owner_id: null, visibility: "global" };
const privateOrphan: Resource = { owner_id: null, visibility: "private" };

const ABILITIES: Ability[] = [
  "view",
  "review",
  "favorite",
  "edit",
  "run",
  "delete",
  "truth",
];

/** Table de cas : [acteur, ressource] → capacités accordées (tout le reste est refusé). */
const TABLE: Array<[string, Actor, Resource, Ability[]]> = [
  [
    "propriétaire, global",
    owner,
    globalOwned,
    ["view", "review", "favorite", "edit", "run", "delete"],
  ],
  [
    "propriétaire, privé",
    owner,
    privateOwned,
    ["view", "review", "favorite", "edit", "run", "delete"],
  ],
  ["autre testeur, global", other, globalOwned, ["view", "review", "favorite"]],
  ["autre testeur, privé", other, privateOwned, []],
  ["admin, global d'un autre", admin, globalOwned, ABILITIES],
  ["admin, privé d'un autre", admin, privateOwned, []],
  [
    "testeur, global d'avant les comptes",
    other,
    globalLegacy,
    ["view", "review", "favorite"],
  ],
  ["admin, global d'avant les comptes", admin, globalLegacy, ABILITIES],
  ["testeur, privé orphelin", owner, privateOrphan, []],
  ["admin, privé orphelin", admin, privateOrphan, []],
];

describe("autorisations (table de cas)", () => {
  for (const [label, actor, resource, granted] of TABLE)
    it(label, () => {
      for (const ability of ABILITIES)
        expect(can(actor, ability, resource), `${label} / ${ability}`).toBe(
          granted.includes(ability),
        );
    });

  it("la vérité terrain est réservée aux administrateurs, même propriétaire", () => {
    expect(can(owner, "truth", globalOwned)).toBe(false);
    expect(can(admin, "truth", globalOwned)).toBe(true);
  });

  it("un audio privé n'est visible que de son propriétaire", () => {
    expect(canView(owner, privateOwned)).toBe(true);
    expect(canView(other, privateOwned)).toBe(false);
    expect(canView(admin, privateOwned)).toBe(false);
  });
});

describe("décision HTTP", () => {
  it("404 (absent) pour l'invisible et l'inexistant, jamais 403", () => {
    expect(decide(other, "view", privateOwned)).toBe("absent");
    expect(decide(other, "edit", privateOwned)).toBe("absent");
    expect(decide(admin, "view", privateOwned)).toBe("absent");
    expect(decide(other, "view", null)).toBe("absent");
  });
  it("403 (interdit) quand la session est visible mais pas modifiable", () => {
    expect(decide(other, "edit", globalOwned)).toBe("forbidden");
    expect(decide(other, "delete", globalLegacy)).toBe("forbidden");
    expect(decide(owner, "truth", globalOwned)).toBe("forbidden");
  });
  it("accorde sinon", () => {
    expect(decide(owner, "delete", privateOwned)).toBe("ok");
    expect(decide(other, "review", globalOwned)).toBe("ok");
  });
});
