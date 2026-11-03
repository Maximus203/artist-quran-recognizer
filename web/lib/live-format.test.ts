import { describe, expect, it } from "vitest";
import { decimalFr, formatClock, plural, verseName } from "./live-format";

describe("live-format", () => {
  it("nomme un verset avec sa sourate, sans rien deviner d'une référence illisible", () => {
    expect(verseName("1:2")).toBe("Al-Fatiha 1:2");
    expect(verseName("112:1")).toMatch(/^.+ 112:1$/);
    expect(verseName("0:1")).toBe("0:1");
    expect(verseName("autre")).toBe("autre");
    expect(verseName("115:1")).toBe("115:1");
  });
  it("formate la durée", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(21.9)).toBe("00:21");
    expect(formatClock(4503)).toBe("75:03");
    expect(formatClock(-3)).toBe("00:00");
    expect(formatClock(NaN)).toBe("00:00");
  });
  it("accorde et arrondit", () => {
    expect(plural(1, "mot", "mots")).toBe("1 mot");
    expect(plural(3, "mot", "mots")).toBe("3 mots");
    expect(decimalFr(5.34)).toBe("5,3");
  });
});
