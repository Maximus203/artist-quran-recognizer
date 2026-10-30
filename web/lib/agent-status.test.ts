import { describe, expect, it } from "vitest";
import {
  agentState,
  seenLabel,
  type AgentLike,
  ONLINE_WITHIN_MS,
} from "./agent-status";

const NOW = Date.parse("2026-10-30T15:00:00.000Z");
const agent = (over: Partial<AgentLike> = {}): AgentLike => ({
  created_at: "2026-10-30T14:00:00.000Z",
  last_seen_at: null,
  revoked_at: null,
  ...over,
});
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("état d'un agent du moteur", () => {
  it("révoqué l'emporte sur tout, même vu à l'instant", () => {
    expect(
      agentState(
        agent({ revoked_at: ago(1000), last_seen_at: ago(1000) }),
        NOW,
      ),
    ).toBe("revoked");
  });

  it("jamais vu : le jeton existe, aucun agent ne l'a encore utilisé", () => {
    expect(agentState(agent(), NOW)).toBe("never");
  });

  it("en ligne tant que le dernier signal est récent", () => {
    expect(agentState(agent({ last_seen_at: ago(5_000) }), NOW)).toBe("online");
    expect(
      agentState(agent({ last_seen_at: ago(ONLINE_WITHIN_MS - 1) }), NOW),
    ).toBe("online");
  });

  it("silencieux au-delà du délai : l'agent a cessé d'appeler", () => {
    expect(
      agentState(agent({ last_seen_at: ago(ONLINE_WITHIN_MS + 1) }), NOW),
    ).toBe("silent");
    expect(agentState(agent({ last_seen_at: ago(3 * 3600_000) }), NOW)).toBe(
      "silent",
    );
  });

  it("une date illisible ne plante pas : traitée comme jamais vu", () => {
    expect(agentState(agent({ last_seen_at: "n'importe quoi" }), NOW)).toBe(
      "never",
    );
  });
});

describe("dernière activité lisible", () => {
  it.each([
    [null, "jamais"],
    [ago(4_000), "à l'instant"],
    [ago(90_000), "il y a 1 min"],
    [ago(12 * 60_000), "il y a 12 min"],
    [ago(3 * 3600_000), "il y a 3 h"],
    [ago(2 * 24 * 3600_000), "il y a 2 j"],
  ])("%s → %s", (iso, label) => {
    expect(seenLabel(iso, NOW)).toBe(label);
  });

  it("une date dans le futur (horloges décalées) reste « à l'instant »", () => {
    expect(seenLabel(new Date(NOW + 60_000).toISOString(), NOW)).toBe(
      "à l'instant",
    );
  });
});
