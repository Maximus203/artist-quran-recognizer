import { describe, expect, it } from "vitest";
import {
  CHUNK,
  focusTarget,
  rowsToRender,
  scrollTopFor,
  visibleRows,
} from "./virtual-list";

describe("visibleRows", () => {
  it("couvre la zone visible plus une marge, alignée par paquets", () => {
    const { start, end } = visibleRows(3000, 44, 4400, 560);
    // lignes 100 à 112 visibles ; marge puis arrondi au paquet
    expect(start).toBeLessThanOrEqual(100 - 1);
    expect(end).toBeGreaterThanOrEqual(113);
    expect(start % CHUNK).toBe(0);
    expect(end - start).toBeLessThan(60);
  });
  it("reste dans [0, nombre de lignes]", () => {
    expect(visibleRows(3000, 44, 0, 560).start).toBe(0);
    const bottom = visibleRows(3000, 44, 3000 * 44 - 560, 560);
    expect(bottom.end).toBe(3000);
    expect(visibleRows(5, 44, 0, 560)).toEqual({ start: 0, end: 5 });
  });
  it("ne rend rien sans ligne, ni sans hauteur connue", () => {
    expect(visibleRows(0, 44, 0, 560)).toEqual({ start: 0, end: 0 });
    expect(visibleRows(100, 0, 0, 560)).toEqual({ start: 0, end: 0 });
  });
  it("ne change pas de fenêtre tant que le défilement reste dans le même paquet", () => {
    const a = visibleRows(3000, 44, 4400, 560);
    const b = visibleRows(3000, 44, 4400 + 10, 560);
    expect(b).toEqual(a);
  });
});

describe("rowsToRender", () => {
  it("ajoute la ligne qui porte la tabulation quand elle est hors fenêtre", () => {
    expect(rowsToRender({ start: 8, end: 12 }, 100, 200)).toEqual([
      8, 9, 10, 11, 100,
    ]);
    expect(rowsToRender({ start: 8, end: 12 }, 3, 200)).toEqual([
      3, 8, 9, 10, 11,
    ]);
  });
  it("ignore une ligne qui n'existe plus (filtre changé)", () => {
    expect(rowsToRender({ start: 0, end: 3 }, 500, 20)).toEqual([0, 1, 2]);
  });
  it("ne double rien quand la ligne est déjà dans la fenêtre ou absente", () => {
    expect(rowsToRender({ start: 8, end: 11 }, 9, 20)).toEqual([8, 9, 10]);
    expect(rowsToRender({ start: 8, end: 11 }, null, 20)).toEqual([8, 9, 10]);
    expect(rowsToRender({ start: 0, end: 3 }, 50, 20)).toEqual([0, 1, 2]);
  });
});

describe("scrollTopFor", () => {
  it("ne bouge pas quand la ligne est entièrement visible", () => {
    expect(scrollTopFor(12, 44, 400, 560)).toBe(400);
  });
  it("aligne sur le haut quand la ligne est au-dessus, sur le bas quand elle est dessous", () => {
    expect(scrollTopFor(2, 44, 400, 560)).toBe(88);
    expect(scrollTopFor(40, 44, 400, 560)).toBe(40 * 44 + 44 - 560);
  });
  it("ne descend jamais sous zéro", () => {
    expect(scrollTopFor(0, 44, 100, 560)).toBe(0);
  });
});

describe("focusTarget", () => {
  it("flèches : une ligne à la fois, bornée", () => {
    expect(focusTarget("ArrowDown", 5, 100, 10)).toBe(6);
    expect(focusTarget("ArrowUp", 5, 100, 10)).toBe(4);
    expect(focusTarget("ArrowUp", 0, 100, 10)).toBe(0);
    expect(focusTarget("ArrowDown", 99, 100, 10)).toBe(99);
  });
  it("Début, Fin, Page précédente et suivante", () => {
    expect(focusTarget("Home", 50, 100, 10)).toBe(0);
    expect(focusTarget("End", 50, 100, 10)).toBe(99);
    expect(focusTarget("PageDown", 50, 100, 10)).toBe(60);
    expect(focusTarget("PageUp", 50, 100, 10)).toBe(40);
    expect(focusTarget("PageDown", 95, 100, 10)).toBe(99);
    expect(focusTarget("PageUp", 3, 100, 10)).toBe(0);
  });
  it("laisse passer les autres touches", () => {
    expect(focusTarget("a", 5, 100, 10)).toBeNull();
    expect(focusTarget("Enter", 5, 100, 10)).toBeNull();
    expect(focusTarget("ArrowDown", 0, 0, 10)).toBeNull();
  });
});
