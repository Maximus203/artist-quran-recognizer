import { describe, expect, it } from "vitest";
import {
  listenWindow,
  moveEdge,
  nudgeEdge,
  pressMark,
  roundTenth,
  traceToSelection,
} from "./marking";

describe("roundTenth", () => {
  it("arrondit au dixième", () => {
    expect(roundTenth(101.24)).toBe(101.2);
    expect(roundTenth(101.25)).toBe(101.3);
    expect(roundTenth(0)).toBe(0);
  });
});

describe("pressMark (bouton unique début → fin)", () => {
  it("le premier appui pose le début à la position de lecture arrondie", () => {
    expect(pressMark(null, 101.234)).toEqual({ kind: "start", start: 101.2 });
  });
  it("le second appui pose la fin et crée la plage", () => {
    expect(pressMark(101.2, 106.44)).toEqual({
      kind: "range",
      start: 101.2,
      end: 106.4,
    });
  });
  it("refuse une fin trop proche du début (moins de 0,2 s)", () => {
    expect(pressMark(101.2, 101.3)).toEqual({ kind: "too_short" });
    expect(pressMark(101.2, 101.2)).toEqual({ kind: "too_short" });
  });
  it("accepte exactement 0,2 s", () => {
    expect(pressMark(101.2, 101.4)).toEqual({
      kind: "range",
      start: 101.2,
      end: 101.4,
    });
  });
  it("refuse une fin avant le début (lecture reculée)", () => {
    expect(pressMark(101.2, 90)).toEqual({ kind: "too_short" });
  });
});

describe("traceToSelection (tracé sur la forme d'onde)", () => {
  it("un glissement de plus de 6 px et 0,2 s trace une plage, dans les deux sens", () => {
    expect(traceToSelection({ t0: 10, t1: 14.5, dxPx: 120 })).toEqual({
      mode: "range",
      start: 10,
      end: 14.5,
    });
    expect(traceToSelection({ t0: 14.5, t1: 10, dxPx: -120 })).toEqual({
      mode: "range",
      start: 10,
      end: 14.5,
    });
  });
  it("un simple toucher (moins de 6 px) pose un point", () => {
    expect(traceToSelection({ t0: 31.24, t1: 31.3, dxPx: 3 })).toEqual({
      mode: "point",
      start: 31.2,
    });
  });
  it("un glissement trop court en durée (zoom large) pose un point", () => {
    expect(traceToSelection({ t0: 10, t1: 10.1, dxPx: 20 })).toEqual({
      mode: "point",
      start: 10,
    });
  });
  it("un tracé qui arrondit à moins de 0,2 s reste un point", () => {
    expect(traceToSelection({ t0: 10.01, t1: 10.19, dxPx: 20 })).toEqual({
      mode: "point",
      start: 10,
    });
  });
});

describe("moveEdge / nudgeEdge (poignées, − / +, caler)", () => {
  const range = { start: 101.2, end: 106.4 };
  it("déplace le début sans dépasser la fin moins 0,2 s", () => {
    expect(moveEdge(range, "start", 103, 184.7)).toEqual({
      start: 103,
      end: 106.4,
    });
    expect(moveEdge(range, "start", 200, 184.7)).toEqual({
      start: 106.2,
      end: 106.4,
    });
  });
  it("déplace la fin sans passer sous le début plus 0,2 s ni après la durée", () => {
    expect(moveEdge(range, "end", 110, 184.7).end).toBe(110);
    expect(moveEdge(range, "end", 100, 184.7).end).toBe(101.4);
    expect(moveEdge(range, "end", 999, 184.7).end).toBe(184.7);
  });
  it("borne le début à zéro", () => {
    expect(moveEdge(range, "start", -5, 184.7).start).toBe(0);
  });
  it("un point n'a qu'un début", () => {
    expect(moveEdge({ start: 31.2, end: null }, "start", 40.04, 184.7)).toEqual(
      { start: 40, end: null },
    );
    expect(moveEdge({ start: 31.2, end: null }, "end", 40, 184.7)).toEqual({
      start: 31.2,
      end: null,
    });
  });
  it("nudgeEdge avance par pas, flottants arrondis", () => {
    expect(nudgeEdge(range, "start", 0.1, 184.7).start).toBe(101.3);
    expect(nudgeEdge(range, "end", -0.1, 184.7).end).toBe(106.3);
    expect(nudgeEdge(range, "end", 1, 184.7).end).toBe(107.4);
  });
});

describe("listenWindow", () => {
  it("rejoue la plage telle quelle", () => {
    expect(listenWindow({ start: 101.2, end: 106.4 }, 184.7)).toEqual([
      101.2, 106.4,
    ]);
  });
  it("écoute 2 s autour d'un point, borné au fichier", () => {
    expect(listenWindow({ start: 31.2, end: null }, 184.7)).toEqual([
      29.2, 33.2,
    ]);
    expect(listenWindow({ start: 0.5, end: null }, 184.7)).toEqual([0, 2.5]);
    expect(listenWindow({ start: 184, end: null }, 184.7)).toEqual([
      182, 184.7,
    ]);
  });
});
