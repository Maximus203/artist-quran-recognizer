import { afterEach, describe, expect, it, vi } from "vitest";
import { audit, pseudonymize } from "./audit";

afterEach(() => vi.restoreAllMocks());

describe("journal d'audit", () => {
  it("une ligne JSON par événement, adresse pseudonymisée, jamais de secret", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    audit("login.failure", {
      userId: 7,
      ip: "203.0.113.9",
      reason: "mot de passe",
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const line = String(spy.mock.calls[0][0]);
    expect(line).toMatch(/INFO audit: \{/);
    const payload = JSON.parse(line.slice(line.indexOf("{")));
    expect(payload).toMatchObject({
      event: "login.failure",
      user: 7,
      reason: "mot de passe",
    });
    expect(payload.ip).toMatch(/^[0-9a-f]{12}$/);
    expect(line).not.toContain("203.0.113.9");
  });

  it("la même adresse donne la même empreinte ; deux adresses, deux empreintes", () => {
    expect(pseudonymize("10.0.0.1")).toBe(pseudonymize("10.0.0.1"));
    expect(pseudonymize("10.0.0.1")).not.toBe(pseudonymize("10.0.0.2"));
  });

  it("sans compte ni adresse : ces champs sont absents", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    audit("logout", {});
    const line = String(spy.mock.calls[0][0]);
    const payload = JSON.parse(line.slice(line.indexOf("{")));
    expect(Object.keys(payload).sort()).toEqual(["event"]);
  });
});
