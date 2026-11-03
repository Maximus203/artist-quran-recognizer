import { describe, expect, it } from "vitest";
import { blocksAt, hitLayout } from "./export-video-edit";
import { DEFAULT_LAYOUTS } from "./export-video-model";

const FRAME = { width: 338, height: 190 };
const layout = DEFAULT_LAYOUTS["16:9"];

describe("hitLayout (de quoi attraper un élément du doigt : 44 px au moins)", () => {
  it("agrandit autour de son centre un élément plus petit que 44 px, sans toucher aux autres", () => {
    // La sourate fait 11 px de haut dans ce cadre : sa zone d'appui en fait 44, centrée sur la même ligne.
    const middle = { ...layout, ref: { x: 0.25, y: 0.4, w: 0.5, h: 0.06 } };
    const hit = hitLayout(middle, FRAME);
    expect(middle.ref.h * FRAME.height).toBeLessThan(44);
    expect(hit.ref.h * FRAME.height).toBeCloseTo(44, 6);
    expect(hit.ref.y + hit.ref.h / 2).toBeCloseTo(
      middle.ref.y + middle.ref.h / 2,
      6,
    );
    expect(hit.ref.x).toBe(middle.ref.x);
    expect(hit.ref.w).toBe(middle.ref.w);
    // L'arabe est assez grand : inchangé.
    expect(hit.arabic).toEqual(layout.arabic);
  });

  it("la largeur aussi : un élément étroit gagne en largeur", () => {
    const narrow = { ...layout, ref: { x: 0.4, y: 0.3, w: 0.1, h: 0.3 } };
    const hit = hitLayout(narrow, FRAME);
    expect(hit.ref.w * FRAME.width).toBeCloseTo(44, 6);
    expect(hit.ref.h).toBe(narrow.ref.h);
  });

  it("reste dans le cadre : un élément collé au bord est décalé, pas coupé", () => {
    const edge = { ...layout, ref: { x: 0, y: 0, w: 0.3, h: 0.05 } };
    const hit = hitLayout(edge, FRAME);
    expect(hit.ref.y).toBeGreaterThanOrEqual(0);
    expect(hit.ref.y + hit.ref.h).toBeLessThanOrEqual(1 + 1e-9);
    expect(hit.ref.h * FRAME.height).toBeCloseTo(44, 6);
    const bottom = hitLayout(
      { ...layout, wave: { x: 0, y: 0.97, w: 1, h: 0.03 } },
      FRAME,
    );
    expect(bottom.wave.y + bottom.wave.h).toBeLessThanOrEqual(1 + 1e-9);
    expect(bottom.wave.h * FRAME.height).toBeCloseTo(44, 6);
  });

  it("un cadre plus petit que 44 px : la zone prend tout le cadre", () => {
    const hit = hitLayout(layout, { width: 30, height: 30 });
    expect(hit.arabic.w).toBe(1);
    expect(hit.arabic.h).toBe(1);
  });

  it("un cadre sans taille (pas encore mesuré) : la mise en page telle quelle", () => {
    expect(hitLayout(layout, { width: 0, height: 0 })).toEqual(layout);
  });

  it("ne modifie pas la mise en page reçue", () => {
    const before = structuredClone(layout);
    hitLayout(layout, FRAME);
    expect(layout).toEqual(before);
  });

  it("on attrape la sourate en visant un peu au-dessus ou en dessous de sa ligne", () => {
    const hit = hitLayout(layout, FRAME);
    const centre = layout.ref.y + layout.ref.h / 2;
    const above = { x: 0.5, y: centre - 15 / FRAME.height };
    expect(blocksAt(layout, above)).not.toContain("ref");
    expect(blocksAt(hit, above)).toContain("ref");
  });
});
