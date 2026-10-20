import { describe, expect, it } from "vitest";
import {
  ZOOM_SPANS,
  centeredScroll,
  formatTick,
  laneWidthPercent,
  percentAt,
  tickStep,
  ticks,
  visibleSpan,
} from "./timeline";

describe("percentAt", () => {
  it("place un instant dans le même repère que les segments", () => {
    expect(percentAt(0, 100)).toBe(0);
    expect(percentAt(25, 100)).toBe(25);
    expect(percentAt(100, 100)).toBe(100);
  });
  it("borne hors de l'audio et sans durée connue", () => {
    expect(percentAt(-3, 100)).toBe(0);
    expect(percentAt(130, 100)).toBe(100);
    expect(percentAt(10, 0)).toBe(0);
    expect(percentAt(Number.NaN, 100)).toBe(0);
  });
});

describe("zoom par fenêtre visible", () => {
  it("propose le fichier entier puis des fenêtres de plus en plus fines", () => {
    expect(ZOOM_SPANS[0].seconds).toBeNull();
    const spans = ZOOM_SPANS.slice(1).map((z) => z.seconds as number);
    expect(spans).toEqual([...spans].sort((a, b) => b - a));
    expect(Math.min(...spans)).toBeLessThanOrEqual(10);
  });
  it("élargit les pistes à durée / fenêtre, jamais sous 100 %", () => {
    expect(laneWidthPercent(2742, null)).toBe(100);
    expect(laneWidthPercent(2742, 60)).toBeCloseTo(4570);
    expect(laneWidthPercent(30, 60)).toBe(100);
  });
  it("fenêtre visible : la fenêtre choisie ou le fichier entier", () => {
    expect(visibleSpan(2742, null)).toBe(2742);
    expect(visibleSpan(2742, 20)).toBe(20);
    expect(visibleSpan(12, 60)).toBe(12);
  });
});

describe("centeredScroll", () => {
  it("centre l'instant dans la fenêtre", () => {
    // contenu 10 000 px pour 1000 s, fenêtre 1000 px : 400 s -> 4000 px, centré -> 3500
    expect(centeredScroll(400, 1000, 1000, 10000)).toBe(3500);
  });
  it("ne sort jamais du contenu", () => {
    expect(centeredScroll(1, 1000, 1000, 10000)).toBe(0);
    expect(centeredScroll(999, 1000, 1000, 10000)).toBe(9000);
    expect(centeredScroll(50, 0, 1000, 10000)).toBe(0);
  });
});

describe("graduations", () => {
  it("choisit un pas rond qui donne une dizaine de repères", () => {
    expect(tickStep(2742)).toBe(300);
    expect(tickStep(60)).toBe(5);
    expect(tickStep(8)).toBe(1);
    expect(tickStep(2)).toBe(0.2);
  });
  it("espace les repères selon la largeur affichée (mobile)", () => {
    // 300 px : au plus 4 libellés de 64 px
    expect(tickStep(2742, 300)).toBe(900);
    expect(tickStep(60, 300)).toBe(15);
    expect(tickStep(2742, 2000)).toBe(300);
  });
  it("énumère les repères de 0 à la durée, sans dérive flottante", () => {
    expect(ticks(10, 2)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(ticks(1, 0.2)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(ticks(0, 5)).toEqual([]);
  });
  it("formate selon la finesse du pas", () => {
    expect(formatTick(125, 5)).toBe("02:05");
    expect(formatTick(3725, 300)).toBe("1:02:05");
    expect(formatTick(1.5, 0.5)).toBe("00:01.5");
  });
});
