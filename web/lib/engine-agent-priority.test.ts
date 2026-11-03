import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "./db";
import {
  PREFERRED_ONLINE_MS,
  createAgent,
  listAgents,
  moveAgent,
  preferredAgentAvailable,
  revokeAgent,
} from "./engine-agents";

/**
 * Premier choix / secours : les agents sont ordonnés ; un agent de secours n'est servi que si aucun agent
 * préféré n'est en ligne ET disponible. REVERB (GPU) en premier, Atlas (processeur) en secours.
 */
let tmp = "";
let db: Db;
let admin = 0;
const NOW = Date.parse("2026-10-30T16:00:00.000Z");
const seen = (id: number, msAgo: number) =>
  db
    .prepare("UPDATE engine_agents SET last_seen_at = ? WHERE id = ?")
    .run(new Date(NOW - msAgo).toISOString(), id);
const names = () => listAgents(db).map((a) => a.name);

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-prio-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
  const { getDb } = await import("./db");
  const { createUser } = await import("./users");
  db = getDb();
  admin = createUser(db, { username: "admin1", passwordHash: "x" }).id;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("./db");
  closeDb();
  await rm(tmp, { recursive: true, force: true });
});

const make = (name: string) => createAgent(db, { name, createdBy: admin }).row;

describe("ordre des agents", () => {
  it("un nouvel agent arrive en dernier (secours) ; la liste suit l'ordre de préférence", () => {
    make("atlas");
    make("REVERB");
    expect(names()).toEqual(["atlas", "REVERB"]);
  });

  it("monter REVERB le met en premier choix, redescendre le remet en secours", () => {
    const atlas = make("atlas");
    const reverb = make("REVERB");
    expect(moveAgent(db, reverb.id, "up")).toBe(true);
    expect(names()).toEqual(["REVERB", "atlas"]);
    expect(moveAgent(db, reverb.id, "down")).toBe(true);
    expect(names()).toEqual(["atlas", "REVERB"]);
    expect(atlas.id).toBeLessThan(reverb.id);
  });

  it("on ne dépasse pas les extrémités : le premier ne monte pas, le dernier ne descend pas", () => {
    const first = make("a");
    const last = make("b");
    expect(moveAgent(db, first.id, "up")).toBe(false);
    expect(moveAgent(db, last.id, "down")).toBe(false);
    expect(names()).toEqual(["a", "b"]);
  });

  it("agent inconnu ou révoqué : faux ; un révoqué ne compte pas dans l'ordre", () => {
    const a = make("a");
    const b = make("b");
    const c = make("c");
    expect(moveAgent(db, 9999, "up")).toBe(false);
    revokeAgent(db, b.id);
    expect(moveAgent(db, b.id, "up")).toBe(false);
    // c monte au-dessus de a : le révoqué b est ignoré, pas un cran « fantôme »
    expect(moveAgent(db, c.id, "up")).toBe(true);
    const active = listAgents(db)
      .filter((x) => !x.revoked_at)
      .map((x) => x.name);
    expect(active).toEqual(["c", "a"]);
    expect(a.id).toBeLessThan(c.id);
  });

  it("des priorités égales (anciennes données) se départagent par ancienneté, et monter les normalise", () => {
    const a = make("a");
    const b = make("b");
    db.prepare("UPDATE engine_agents SET priority = 5").run();
    expect(names()).toEqual(["a", "b"]);
    expect(moveAgent(db, b.id, "up")).toBe(true);
    expect(names()).toEqual(["b", "a"]);
    expect(new Set(listAgents(db).map((x) => x.priority)).size).toBe(2);
    expect(a.id).toBeLessThan(b.id);
  });
});

describe("le secours attend-il un agent préféré ?", () => {
  const setup = () => {
    const first = make("REVERB");
    const second = make("atlas");
    moveAgent(db, second.id, "up"); // atlas passe devant : on veut REVERB devant
    moveAgent(db, first.id, "up");
    return { reverb: first.id, atlas: second.id };
  };
  const idle = () => false;

  it("l'agent préféré est en ligne et libre : le secours attend", () => {
    const { reverb, atlas } = setup();
    seen(reverb, 10_000);
    expect(preferredAgentAvailable(db, atlas, idle, NOW)).toBe(true);
  });

  it("l'agent préféré est occupé : le secours prend le relais (deux analyses en parallèle)", () => {
    const { reverb, atlas } = setup();
    seen(reverb, 10_000);
    expect(preferredAgentAvailable(db, atlas, (id) => id === reverb, NOW)).toBe(
      false,
    );
  });

  it("l'agent préféré est silencieux depuis trop longtemps (PC éteint ou en veille) : le secours prend", () => {
    const { reverb, atlas } = setup();
    seen(reverb, PREFERRED_ONLINE_MS + 1_000);
    expect(preferredAgentAvailable(db, atlas, idle, NOW)).toBe(false);
  });

  it("jamais vu ou révoqué : ne retient personne", () => {
    const { reverb, atlas } = setup();
    expect(preferredAgentAvailable(db, atlas, idle, NOW)).toBe(false); // jamais vu
    seen(reverb, 1_000);
    revokeAgent(db, reverb);
    expect(preferredAgentAvailable(db, atlas, idle, NOW)).toBe(false);
  });

  it("le premier choix lui-même n'attend jamais personne", () => {
    const { reverb, atlas } = setup();
    seen(atlas, 1_000);
    expect(preferredAgentAvailable(db, reverb, idle, NOW)).toBe(false);
  });

  it("trois agents : le dernier attend si l'un des deux premiers est libre", () => {
    const a = make("a");
    const b = make("b");
    const c = make("c");
    seen(b.id, 5_000); // le deuxième est en ligne et libre
    expect(preferredAgentAvailable(db, c.id, idle, NOW)).toBe(true);
    expect(preferredAgentAvailable(db, c.id, (id) => id === b.id, NOW)).toBe(
      false,
    );
    seen(a.id, 5_000);
    expect(preferredAgentAvailable(db, c.id, (id) => id === b.id, NOW)).toBe(
      true, // a est libre
    );
  });
});
