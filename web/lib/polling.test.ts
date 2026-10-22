import { describe, expect, it } from "vitest";
import {
  POLL_ACTIVE_MS,
  POLL_HIDDEN_MS,
  POLL_IDLE_MS,
  pollInterval,
} from "./polling";

describe("pollInterval", () => {
  it("3 s : onglet visible avec une analyse active", () => {
    expect(pollInterval(true, true)).toBe(3000);
    expect(POLL_ACTIVE_MS).toBe(3000);
  });
  it("15 s : onglet en arrière-plan, même avec une analyse active", () => {
    expect(pollInterval(false, true)).toBe(15_000);
    expect(pollInterval(false, false)).toBe(POLL_HIDDEN_MS);
  });
  it("plus lent quand rien ne tourne, sans jamais dépasser le rythme de l'arrière-plan", () => {
    expect(pollInterval(true, false)).toBe(POLL_IDLE_MS);
    expect(POLL_IDLE_MS).toBeGreaterThan(POLL_ACTIVE_MS);
    expect(POLL_IDLE_MS).toBeLessThanOrEqual(POLL_HIDDEN_MS);
  });
});
