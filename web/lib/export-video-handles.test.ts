import { describe, expect, it } from "vitest";
import { HANDLE_HIT, handlePlacements } from "./export-video-edit";

const FRAME = { width: 390, height: 220 };

/** Centre d'une poignée, en pixels, par rapport au coin haut-gauche de la boîte. */
const center = (
  p: ReturnType<typeof handlePlacements>[number],
  w: number,
  h: number,
) => ({ x: (p.left / 100) * w + p.dx, y: (p.top / 100) * h + p.dy });

/** Deux cibles de `HANDLE_HIT` px se recouvrent-elles ? */
function overlaps(
  a: { x: number; y: number },
  b: { x: number; y: number },
): boolean {
  return (
    Math.abs(a.x - b.x) < HANDLE_HIT - 1e-9 &&
    Math.abs(a.y - b.y) < HANDLE_HIT - 1e-9
  );
}

describe("handlePlacements (poignées de 44 px, à l'extérieur)", () => {
  it("la zone tactile d'une poignée est de 44 px", () => {
    expect(HANDLE_HIT).toBe(44);
  });

  it("une grande boîte a ses huit poignées, collées à ses bords", () => {
    const placements = handlePlacements(
      { x: 0.1, y: 0.1, w: 0.8, h: 0.6 },
      FRAME,
    );
    expect(placements.map((p) => p.handle)).toEqual([
      "nw",
      "n",
      "ne",
      "w",
      "e",
      "sw",
      "s",
      "se",
    ]);
    const nw = placements[0];
    expect([nw.left, nw.top, nw.dx, nw.dy]).toEqual([0, 0, 0, 0]);
    const se = placements[7];
    expect([se.left, se.top]).toEqual([100, 100]);
    const n = placements[1];
    expect([n.left, n.top]).toEqual([50, 0]);
  });

  it("une boîte basse (la sourate : 22 px de haut) écarte ses poignées en hauteur et garde ses coins", () => {
    const box = { x: 0.25, y: 0.06, w: 0.5, h: 0.1 };
    const placements = handlePlacements(box, FRAME);
    const handles = placements.map((p) => p.handle);
    expect(handles).toEqual(["nw", "n", "ne", "sw", "s", "se"]); // « w » et « e » n'ont plus de place
    const nw = placements.find((p) => p.handle === "nw");
    expect(nw?.dy).toBeLessThan(0);
    const se = placements.find((p) => p.handle === "se");
    expect(se?.dy).toBeGreaterThan(0);
  });

  it("une boîte étroite écarte ses poignées en largeur et perd « n » et « s »", () => {
    const placements = handlePlacements(
      { x: 0.4, y: 0.1, w: 0.1, h: 0.7 },
      { width: 300, height: 400 },
    );
    expect(placements.map((p) => p.handle)).toEqual([
      "nw",
      "ne",
      "w",
      "e",
      "sw",
      "se",
    ]);
    const nw = placements.find((p) => p.handle === "nw");
    expect(nw?.dx).toBeLessThan(0);
  });

  it("jamais deux cibles l'une sur l'autre, quelle que soit la boîte", () => {
    const sizes = [
      { w: 0.84, h: 0.47 },
      { w: 0.5, h: 0.06 },
      { w: 0.1, h: 0.04 },
      { w: 0.1, h: 0.5 },
      { w: 1, h: 0.04 },
      { w: 0.2, h: 0.2 },
    ];
    for (const frame of [
      FRAME,
      { width: 200, height: 355 },
      { width: 800, height: 450 },
    ])
      for (const size of sizes) {
        const w = size.w * frame.width;
        const h = size.h * frame.height;
        const placements = handlePlacements({ x: 0, y: 0, ...size }, frame);
        for (let i = 0; i < placements.length; i++)
          for (let j = i + 1; j < placements.length; j++)
            expect(
              overlaps(
                center(placements[i], w, h),
                center(placements[j], w, h),
              ),
              `${placements[i].handle}/${placements[j].handle} sur ${w.toFixed(0)}×${h.toFixed(0)}`,
            ).toBe(false);
      }
  });

  it("un cadre sans taille (pas encore mesuré) garde les quatre coins, jamais d'exception", () => {
    const placements = handlePlacements(
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { width: 0, height: 0 },
    );
    expect(placements.map((p) => p.handle)).toEqual(["nw", "ne", "sw", "se"]);
  });
});
