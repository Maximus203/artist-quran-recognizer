import { describe, expect, it } from "vitest";
import { ECHO, clampEcho, echoMix, impulseResponse } from "./audio-echo";

/** L'écho de l'écoute : un dosage sec / écho et la « queue » de réverbération qui le produit. */
describe("dosage de l'écho", () => {
  it("à zéro, la voix est intacte : tout le son direct, aucun écho", () => {
    expect(echoMix(0)).toEqual({ dry: 1, wet: 0 });
  });

  it("l'écho monte avec le réglage, sans jamais étouffer la voix", () => {
    const low = echoMix(0.25);
    const high = echoMix(1);
    expect(high.wet).toBeGreaterThan(low.wet);
    expect(high.dry).toBeGreaterThanOrEqual(0.6);
    expect(high.wet).toBeLessThanOrEqual(1.2);
  });

  it("les valeurs hors bornes ou invalides sont ramenées dans [0, 1]", () => {
    expect(clampEcho(-3)).toBe(0);
    expect(clampEcho(7)).toBe(ECHO.max);
    expect(clampEcho(Number.NaN)).toBe(0);
    expect(clampEcho(0.5)).toBe(0.5);
  });
});

describe("queue de réverbération", () => {
  const rate = 8000;

  it("a la durée demandée, sur deux canaux", () => {
    const channels = impulseResponse(rate, 1.5, 2.5, () => 0.5);
    expect(channels).toHaveLength(2);
    expect(channels[0]).toHaveLength(Math.round(rate * 1.5));
  });

  it("s'éteint : la fin est bien plus faible que le début", () => {
    let seed = 7;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const [left] = impulseResponse(rate, 1.5, 2.5, rand);
    const mean = (from: number, to: number) =>
      left.slice(from, to).reduce((sum, x) => sum + Math.abs(x), 0) /
      (to - from);
    const n = left.length;
    expect(mean(n - 400, n)).toBeLessThan(mean(0, 400) / 10);
  });

  it("deux canaux différents (largeur stéréo) et valeurs bornées", () => {
    let seed = 11;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const [left, right] = impulseResponse(rate, 1, 2, rand);
    expect(left).not.toEqual(right);
    for (const x of left) expect(Math.abs(x)).toBeLessThanOrEqual(1);
  });
});
