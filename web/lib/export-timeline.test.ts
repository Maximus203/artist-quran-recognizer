import { describe, expect, it } from "vitest";
import {
  clampView,
  fitView,
  formatTick,
  keyAction,
  moveRange,
  neighbourTarget,
  panView,
  pinchView,
  rulerStep,
  setEdge,
  snapToTarget,
  spokenTime,
  timeToX,
  xToTime,
  zoomView,
} from "./export-timeline";

const D = 3080;
const MIN = 8;

describe("conversion temps ↔ pixels", () => {
  it("place le début de la vue à 0 px et la fin à la largeur", () => {
    const view = { a: 100, b: 200 };
    expect(timeToX(100, view, 500)).toBe(0);
    expect(timeToX(200, view, 500)).toBe(500);
    expect(timeToX(150, view, 500)).toBe(250);
  });
  it("est réciproque", () => {
    const view = { a: 12.5, b: 47.25 };
    for (const x of [0, 33, 171.5, 343])
      expect(timeToX(xToTime(x, view, 343), view, 343)).toBeCloseTo(x, 9);
  });
  it("ne divise jamais par zéro (largeur nulle)", () => {
    expect(Number.isFinite(xToTime(10, { a: 0, b: 10 }, 0))).toBe(true);
  });
});

describe("vue : bornes, zoom, déplacement, pincement", () => {
  it("garde la vue dans l'audio et au moins MIN secondes", () => {
    expect(clampView(-20, 30, D, MIN)).toEqual({ a: 0, b: 50 });
    expect(clampView(3070, 3100, D, MIN)).toEqual({ a: 3050, b: 3080 });
    expect(clampView(10, 11, D, MIN)).toEqual({ a: 10, b: 18 });
    expect(clampView(0, 9000, D, MIN)).toEqual({ a: 0, b: D });
  });
  it("audio plus court que le zoom minimal : toute la durée", () => {
    expect(clampView(0, 2, 4, MIN)).toEqual({ a: 0, b: 4 });
  });
  it("zoome autour du point visé (il reste sous le pointeur)", () => {
    const view = { a: 100, b: 200 };
    const next = zoomView(view, 0.5, 125, D, MIN);
    expect(next.b - next.a).toBe(50);
    // 125 était au quart de la vue : il y est toujours.
    expect((125 - next.a) / (next.b - next.a)).toBeCloseTo(0.25, 9);
  });
  it("le zoom arrière s'arrête à tout l'audio", () => {
    expect(zoomView({ a: 0, b: 2000 }, 4, 1000, D, MIN)).toEqual({
      a: 0,
      b: D,
    });
  });
  it("déplace sans sortir de l'audio", () => {
    expect(panView({ a: 100, b: 200 }, 50, D)).toEqual({ a: 150, b: 250 });
    expect(panView({ a: 100, b: 200 }, -500, D)).toEqual({ a: 0, b: 100 });
    expect(panView({ a: 2900, b: 3000 }, 500, D)).toEqual({ a: 2980, b: 3080 });
  });
  it("pincer : écarter les doigts zoome, autour du milieu des doigts", () => {
    const start = { a: 100, b: 200 };
    const wider = pinchView(start, 100, 200, 150, D, MIN);
    expect(wider.b - wider.a).toBeCloseTo(50, 9);
    expect((150 - wider.a) / (wider.b - wider.a)).toBeCloseTo(0.5, 9);
    const closer = pinchView(start, 200, 100, 150, D, MIN);
    expect(closer.b - closer.a).toBeCloseTo(200, 9);
  });
  it("cadre une plage avec de l'air autour (25 %, 4 s au moins)", () => {
    expect(fitView({ start: 100, end: 120 }, D, MIN)).toEqual({
      a: 95,
      b: 125,
    });
    expect(fitView({ start: 100, end: 102 }, D, MIN)).toEqual({
      a: 96,
      b: 106,
    });
    expect(fitView({ start: 0, end: D }, D, MIN)).toEqual({ a: 0, b: D });
  });
});

describe("règle des temps", () => {
  it("choisit un pas qui laisse environ 90 px entre deux repères", () => {
    expect(rulerStep(40, 800, 90)).toBe(5); // 40 s sur 800 px : 4,5 s visés
    expect(rulerStep(3080, 343, 90)).toBe(1200);
    expect(rulerStep(4, 1000, 90)).toBe(0.5);
  });
  it("écrit 13:00 sans dixième et 0:00,5 avec", () => {
    expect(formatTick(780)).toBe("13:00");
    expect(formatTick(0.5)).toBe("0:00,5");
    expect(formatTick(3725)).toBe("1:02:05");
  });
  it("dit le temps en clair pour le lecteur d'écran", () => {
    expect(spokenTime(780.84)).toBe("13 min 0,8 s");
    expect(spokenTime(12.25)).toBe("12,3 s");
    expect(spokenTime(3725)).toBe("1 h 2 min 5,0 s");
  });
});

describe("bords d'une plage", () => {
  const r = { start: 10, end: 20 };
  it("garde 0,5 s au moins et reste dans l'audio", () => {
    expect(setEdge(r, "start", 19.9, 30)).toEqual({ start: 19.5, end: 20 });
    expect(setEdge(r, "start", -3, 30)).toEqual({ start: 0, end: 20 });
    expect(setEdge(r, "end", 10.1, 30)).toEqual({ start: 10, end: 10.5 });
    expect(setEdge(r, "end", 99, 30)).toEqual({ start: 10, end: 30 });
  });
  it("arrondit au millième (mêmes valeurs que l'API)", () => {
    expect(setEdge(r, "start", 12.34567, 30).start).toBe(12.346);
  });
  it("déplace la plage entière sans la raccourcir", () => {
    expect(moveRange(r, 5, 30)).toEqual({ start: 15, end: 25 });
    expect(moveRange(r, 50, 30)).toEqual({ start: 20, end: 30 });
    expect(moveRange(r, -50, 30)).toEqual({ start: 0, end: 10 });
  });
});

describe("aimant", () => {
  const view = { a: 0, b: 100 };
  it("colle au repère le plus proche à moins de 10 px", () => {
    // 100 s sur 1000 px : 10 px = 1 s
    expect(snapToTarget(40.4, [10, 40, 41.2], view, 1000, 10)).toBe(40);
    expect(snapToTarget(40.95, [10, 40, 41.2], view, 1000, 10)).toBe(41.2);
  });
  it("ne colle pas au-delà de la tolérance", () => {
    expect(snapToTarget(45, [10, 40, 50], view, 1000, 10)).toBeNull();
  });
});

describe("clavier sur une poignée", () => {
  const k = (key: string, mods: { shift?: boolean; alt?: boolean } = {}) =>
    keyAction(key, { shift: false, alt: false, ...mods });
  it("flèches : 0,1 s ; Maj : 1 s ; Alt : 0,02 s ; pages : 10 s", () => {
    expect(k("ArrowRight")).toEqual({ kind: "delta", seconds: 0.1 });
    expect(k("ArrowLeft", { shift: true })).toEqual({
      kind: "delta",
      seconds: -1,
    });
    expect(k("ArrowUp", { alt: true })).toEqual({
      kind: "delta",
      seconds: 0.02,
    });
    expect(k("PageDown")).toEqual({ kind: "delta", seconds: -10 });
    expect(k("PageUp")).toEqual({ kind: "delta", seconds: 10 });
  });
  it("crochets : bord de passage voisin ; espace : écouter ; Suppr : retirer", () => {
    expect(k("[")).toEqual({ kind: "jump", direction: -1 });
    expect(k("]")).toEqual({ kind: "jump", direction: 1 });
    expect(k(" ")).toEqual({ kind: "play" });
    expect(k("Delete")).toEqual({ kind: "remove" });
    expect(k("Backspace")).toEqual({ kind: "remove" });
  });
  it("ignore les autres touches (Tab doit continuer à circuler)", () => {
    expect(k("Tab")).toBeNull();
    expect(k("a")).toBeNull();
  });
  it("trouve le repère voisin strictement avant ou après", () => {
    const t = [5, 10, 20, 30];
    expect(neighbourTarget(t, 20, 1)).toBe(30);
    expect(neighbourTarget(t, 20, -1)).toBe(10);
    expect(neighbourTarget(t, 20.02, -1)).toBe(10);
    expect(neighbourTarget(t, 31, 1)).toBeNull();
  });
});
