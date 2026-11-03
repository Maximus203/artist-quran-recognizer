import { describe, expect, it } from "vitest";
import {
  formatBytesFr,
  formatClockLength,
  formatDurationFr,
  formatEtaFr,
  formatRealtimeFactor,
  formatRelative,
  formatSecondsFr,
  formatTenths,
} from "./format";

describe("formatTenths", () => {
  it("écrit mm:ss.d au dixième", () => {
    expect(formatTenths(101.2)).toBe("01:41.2");
    expect(formatTenths(0)).toBe("00:00.0");
    expect(formatTenths(31.24)).toBe("00:31.2");
  });
  it("ajoute les heures au-delà d'une heure", () => {
    expect(formatTenths(3725.4)).toBe("1:02:05.4");
  });
  it("borne les valeurs négatives ou invalides à zéro", () => {
    expect(formatTenths(-3)).toBe("00:00.0");
    expect(formatTenths(Number.NaN)).toBe("00:00.0");
  });
  it("ne renvoie jamais 60.0 secondes", () => {
    expect(formatTenths(59.96)).toBe("01:00.0");
  });
});

describe("formatSecondsFr", () => {
  it("utilise la virgule décimale", () => {
    expect(formatSecondsFr(3.4)).toBe("3,4");
    expect(formatSecondsFr(5)).toBe("5,0");
  });
});

describe("formatDurationFr", () => {
  it("compose secondes, minutes, heures", () => {
    expect(formatDurationFr(26)).toBe("26 s");
    expect(formatDurationFr(340)).toBe("5 min 40 s");
    expect(formatDurationFr(60)).toBe("1 min");
    expect(formatDurationFr(4328)).toBe("1 h 12 min");
    expect(formatDurationFr(3600)).toBe("1 h");
  });
  it("arrondit à la seconde et tolère zéro", () => {
    expect(formatDurationFr(0)).toBe("0 s");
    expect(formatDurationFr(25.6)).toBe("26 s");
  });
});

describe("formatEtaFr (arrondi à la minute supérieure)", () => {
  it("« moins d'une minute » sous 60 s", () => {
    expect(formatEtaFr(0)).toBe("moins d’une minute");
    expect(formatEtaFr(59)).toBe("moins d’une minute");
  });
  it("arrondit au-dessus", () => {
    expect(formatEtaFr(60)).toBe("≈ 1 min");
    expect(formatEtaFr(61)).toBe("≈ 2 min");
    expect(formatEtaFr(700)).toBe("≈ 12 min");
  });
  it("passe en heures", () => {
    expect(formatEtaFr(3600)).toBe("≈ 1 h");
    expect(formatEtaFr(4320)).toBe("≈ 1 h 12 min");
  });
});

describe("formatClockLength", () => {
  it("écrit une durée d'audio", () => {
    expect(formatClockLength(1122)).toBe("18:42");
    expect(formatClockLength(4328)).toBe("1:12:08");
    expect(formatClockLength(184.7)).toBe("3:05");
  });
});

describe("formatRealtimeFactor", () => {
  it("donne le nombre de fois plus vite que l'audio", () => {
    expect(formatRealtimeFactor(184.7, 26)).toBe("×7,1");
    expect(formatRealtimeFactor(2475, 340)).toBe("×7,3");
  });
  it("garde deux décimales quand l'analyse est plus lente que l'audio", () => {
    expect(formatRealtimeFactor(3, 132)).toBe("×0,02");
    expect(formatRealtimeFactor(30, 60)).toBe("×0,50");
  });
  it("renvoie null sans durées exploitables", () => {
    expect(formatRealtimeFactor(0, 26)).toBeNull();
    expect(formatRealtimeFactor(100, 0)).toBeNull();
    expect(formatRealtimeFactor(null, 5)).toBeNull();
  });
});

describe("formatRelative", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");
  const at = (offsetMs: number) => new Date(now - offsetMs).toISOString();
  it("exprime l'ancienneté en français", () => {
    expect(formatRelative(at(20_000), now)).toBe("à l’instant");
    expect(formatRelative(at(12 * 60_000), now)).toBe("il y a 12 min");
    expect(formatRelative(at(3 * 3_600_000), now)).toBe("il y a 3 h");
  });
  it("ne plante pas sur une date invalide ou future", () => {
    expect(formatRelative("pas une date", now)).toBe("");
    expect(formatRelative(at(-5000), now)).toBe("à l’instant");
  });
});

describe("formatBytesFr", () => {
  it("choisit l unité lisible", () => {
    expect(formatBytesFr(0)).toBe("0 o");
    expect(formatBytesFr(512)).toBe("512 o");
    expect(formatBytesFr(60000)).toBe("58,6 Ko");
    expect(formatBytesFr(1536 * 1024)).toBe("1,5 Mo");
    expect(formatBytesFr(300 * 1024 * 1024)).toBe("300 Mo");
    expect(formatBytesFr(2 * 1024 ** 3)).toBe("2,0 Go");
    expect(formatBytesFr(-1)).toBe("—");
    expect(formatBytesFr(Number.NaN)).toBe("—");
  });
});
