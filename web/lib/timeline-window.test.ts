import { describe, expect, it } from "vitest";
import {
  capBlocks,
  coalesceSegments,
  renderWindowFor,
  visibleTimeRange,
  windowCovers,
  windowFits,
  windowMatchesSpan,
  type SegLike,
} from "./timeline-window";

const seg = (index: number, start: number, end: number, style = "recognized") =>
  ({ index, start, end, style }) satisfies SegLike;

describe("visibleTimeRange", () => {
  it("convertit le défilement et la largeur en instants", () => {
    // 600 s sur 6000 px de contenu, fenêtre de 1000 px défilée de 2000 px
    expect(visibleTimeRange(2000, 1000, 6000, 600)).toEqual({ a: 200, b: 300 });
  });
  it("borne à [0, durée] et gère l'absence de durée ou de largeur", () => {
    expect(visibleTimeRange(0, 1000, 1000, 600)).toEqual({ a: 0, b: 600 });
    expect(visibleTimeRange(5500, 1000, 6000, 600)).toEqual({ a: 550, b: 600 });
    expect(visibleTimeRange(-50, 1000, 6000, 600).a).toBe(0);
    expect(visibleTimeRange(0, 0, 0, 600)).toEqual({ a: 0, b: 600 });
    expect(visibleTimeRange(0, 1000, 1000, 0)).toEqual({ a: 0, b: 0 });
  });
});

describe("renderWindowFor / windowCovers", () => {
  it("ajoute une marge de chaque côté, bornée au fichier", () => {
    expect(renderWindowFor({ a: 100, b: 200 }, 1000)).toEqual({
      a: 50,
      b: 250,
    });
    expect(renderWindowFor({ a: 10, b: 110 }, 1000)).toEqual({ a: 0, b: 160 });
    expect(renderWindowFor({ a: 950, b: 1000 }, 1000)).toEqual({
      a: 925,
      b: 1000,
    });
    expect(renderWindowFor({ a: 0, b: 1000 }, 1000)).toEqual({ a: 0, b: 1000 });
  });
  it("garde la fenêtre tant que la vue y reste, la change dès qu'elle en sort", () => {
    const win = { a: 50, b: 250 };
    expect(windowCovers(win, { a: 100, b: 200 })).toBe(true);
    expect(windowCovers(win, { a: 60, b: 160 })).toBe(true);
    expect(windowCovers(win, { a: 40, b: 140 })).toBe(false);
    expect(windowCovers(win, { a: 160, b: 260 })).toBe(false);
    expect(windowCovers(null, { a: 0, b: 1 })).toBe(false);
  });
  it("une vue collée au bord du fichier reste couverte par la fenêtre bornée", () => {
    const win = renderWindowFor({ a: 0, b: 100 }, 1000);
    expect(windowCovers(win, { a: 0, b: 100 })).toBe(true);
    const end = renderWindowFor({ a: 900, b: 1000 }, 1000);
    expect(windowCovers(end, { a: 900, b: 1000 })).toBe(true);
  });
});

describe("windowFits", () => {
  it("garde la fenêtre tant qu'elle couvre la vue sans être démesurée", () => {
    const win = renderWindowFor({ a: 100, b: 200 }, 1000);
    expect(windowFits(win, { a: 100, b: 200 })).toBe(true);
    expect(windowFits(win, { a: 90, b: 190 })).toBe(true);
  });
  it("la change quand la vue en sort", () => {
    expect(windowFits({ a: 50, b: 250 }, { a: 40, b: 140 })).toBe(false);
  });
  it("la change quand un zoom avant la laisse démesurée (tout le fichier pour 10 s)", () => {
    expect(windowFits({ a: 0, b: 8000 }, { a: 100, b: 110 })).toBe(false);
    expect(windowFits(null, { a: 0, b: 10 })).toBe(false);
  });
});

describe("windowMatchesSpan", () => {
  it("accepte une fenêtre de rendu faite pour la fenêtre visible actuelle", () => {
    expect(windowMatchesSpan({ a: 50, b: 250 }, 100)).toBe(true);
    expect(windowMatchesSpan({ a: 0, b: 150 }, 100)).toBe(true);
    expect(windowMatchesSpan({ a: 0, b: 8056 }, 8056)).toBe(true);
  });
  it("refuse celle d'avant un zoom avant (démesurée) : pas de milliers de segments un instant", () => {
    expect(windowMatchesSpan({ a: 0, b: 8056 }, 120)).toBe(false);
  });
  it("refuse celle d'avant un zoom arrière (trop petite pour couvrir la vue)", () => {
    expect(windowMatchesSpan({ a: 100, b: 340 }, 8056)).toBe(false);
  });
  it("refuse l'absence de fenêtre", () => {
    expect(windowMatchesSpan(null, 100)).toBe(false);
  });
});

describe("coalesceSegments", () => {
  it("n'absorbe jamais le segment épinglé (l'intervalle choisi garde sa forme)", () => {
    const blocks = coalesceSegments(
      [seg(0, 0, 1), seg(1, 1, 2), seg(2, 2, 3)],
      1,
      4,
      1,
    );
    expect(blocks.map((b) => b.kind)).toEqual(["one", "one", "one"]);
    expect(blocks[1]).toEqual({ kind: "one", index: 1 });
  });
  it("garde chaque segment assez large tel quel", () => {
    const blocks = coalesceSegments([seg(0, 0, 10), seg(1, 10, 20)], 2, 4);
    expect(blocks).toEqual([
      { kind: "one", index: 0 },
      { kind: "one", index: 1 },
    ]);
  });
  it("fusionne des segments étroits contigus de même style en un seul bloc", () => {
    const blocks = coalesceSegments(
      [
        seg(0, 0, 1, "abstention"),
        seg(1, 1, 2, "abstention"),
        seg(2, 2, 3, "abstention"),
      ],
      1,
      4,
    );
    expect(blocks).toEqual([
      {
        kind: "run",
        first: 0,
        last: 2,
        start: 0,
        end: 3,
        style: "abstention",
        count: 3,
      },
    ]);
  });
  it("ne fusionne pas des styles différents ni un segment large", () => {
    const blocks = coalesceSegments(
      [
        seg(0, 0, 1, "abstention"),
        seg(1, 1, 2, "uncertain"),
        seg(2, 2, 30, "recognized"),
        seg(3, 30, 31, "abstention"),
      ],
      1,
      4,
    );
    expect(blocks.map((b) => b.kind)).toEqual(["one", "one", "one", "one"]);
  });
  it("coupe la fusion au-delà d'un trou visible entre deux segments", () => {
    const blocks = coalesceSegments(
      [seg(0, 0, 1), seg(1, 1.5, 2.5), seg(2, 20, 21)],
      1,
      4,
    );
    // 0→1 et 1.5→2.5 (trou de 0,5 px) fusionnent ; 20→21 est trop loin
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      kind: "run",
      first: 0,
      last: 1,
      count: 2,
    });
    expect(blocks[1]).toEqual({ kind: "one", index: 2 });
  });
  it("un segment étroit isolé reste un segment (pas un bloc de un)", () => {
    expect(coalesceSegments([seg(7, 0, 1)], 1, 4)).toEqual([
      { kind: "one", index: 7 },
    ]);
  });
  it("ne renvoie rien sans segment, et rien de non fini", () => {
    expect(coalesceSegments([], 1, 4)).toEqual([]);
    expect(coalesceSegments([seg(0, 0, 1)], 0, 4)).toEqual([
      { kind: "one", index: 0 },
    ]);
  });
});

describe("capBlocks", () => {
  it("resserre le seuil jusqu'à tenir sous le plafond quand les styles se suivent", () => {
    const segs = Array.from({ length: 400 }, (_, n) =>
      seg(n, n * 3, n * 3 + 3, n % 40 < 20 ? "abstention" : "recognized"),
    );
    // à 1 px/s chaque segment fait 3 px : sous 4 px ils fusionnent déjà par style
    const blocks = capBlocks(segs, 1, 25);
    expect(blocks.length).toBeLessThanOrEqual(25);
  });
  it("rend le résultat au seuil minimal quand le plafond n'est pas atteint", () => {
    const segs = [seg(0, 0, 100), seg(1, 100, 200)];
    expect(capBlocks(segs, 1, 50)).toEqual(coalesceSegments(segs, 1));
  });
});
