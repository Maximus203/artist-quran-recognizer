import { describe, expect, it } from "vitest";
import { canImport, storageState } from "./storage-meter";

const GO = 1024 ** 3;

describe("storageState", () => {
  it("sans quota : illimité, jamais d'alerte", () => {
    expect(storageState({ used_bytes: 9 * GO, limit_bytes: null })).toEqual({
      state: "ok",
      percent: 0,
      remaining: null,
    });
  });
  it("normal sous 80 %", () => {
    const s = storageState({ used_bytes: 2 * GO, limit_bytes: 5 * GO });
    expect(s.state).toBe("ok");
    expect(s.percent).toBe(40);
    expect(s.remaining).toBe(3 * GO);
  });
  it("alerte à partir de 80 %", () => {
    expect(
      storageState({ used_bytes: 4 * GO, limit_bytes: 5 * GO }).state,
    ).toBe("warn");
    expect(
      storageState({ used_bytes: 3.9 * GO, limit_bytes: 5 * GO }).state,
    ).toBe("ok");
  });
  it("plein à 100 % et au-delà, jamais plus de 100 % affichés", () => {
    const s = storageState({ used_bytes: 6 * GO, limit_bytes: 5 * GO });
    expect(s.state).toBe("full");
    expect(s.percent).toBe(100);
    expect(s.remaining).toBe(0);
  });
});

describe("canImport", () => {
  const quota = { used_bytes: 4.8 * GO, limit_bytes: 5 * GO };
  it("accepte ce qui tient dans l'espace libre", () => {
    expect(canImport(0.1 * GO, quota, 500 * 1024 ** 2)).toEqual({ ok: true });
  });
  it("refuse avant l'envoi ce qui dépasse l'espace libre, en le disant", () => {
    const r = canImport(0.4 * GO, quota, 500 * 1024 ** 2);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/dépasse ton espace libre/);
  });
  it("refuse un fichier au-dessus de la taille maximale", () => {
    const r = canImport(
      600 * 1024 ** 2,
      { used_bytes: 0, limit_bytes: null },
      500 * 1024 ** 2,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/taille maximale/);
  });
  it("sans quota ni plafond, tout passe", () => {
    expect(
      canImport(10 * GO, { used_bytes: 0, limit_bytes: null }, null),
    ).toEqual({ ok: true });
  });
});
