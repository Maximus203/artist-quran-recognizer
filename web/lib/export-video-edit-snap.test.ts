import { describe, expect, it } from "vitest";
import { moveBox, resizeBox } from "./export-video-edit";

/**
 * Un cadre n'est pas carré : 10 px d'écran valent 0,01 du cadre en largeur et 0,02 en hauteur sur un
 * cadre de 1000 × 500. L'aimant a donc un seuil par axe (`snap` en x, `snapY` en y).
 */
describe("seuil d'aimant distinct en hauteur (snapY)", () => {
  it("moveBox : l'axe vertical utilise snapY, l'horizontal snap", () => {
    // Milieu en x à 0,015 du centre : pris avec snap 0,02, pas avec 0,01.
    const b = { x: 0.3 - 0.015, y: 0.2, w: 0.4, h: 0.2 };
    const hitX = moveBox(b, { dx: 0, dy: 0 }, { snap: 0.02, snapY: 0.001 });
    expect(hitX.guides.some((g) => g.axis === "x")).toBe(true);
    const missX = moveBox(b, { dx: 0, dy: 0 }, { snap: 0.01, snapY: 0.001 });
    expect(missX.guides.some((g) => g.axis === "x")).toBe(false);
    // Milieu en y à 0,015 du centre : pris avec snapY 0,02 même si snap est minuscule.
    const v = { x: 0.2, y: 0.3 - 0.015, w: 0.4, h: 0.4 };
    const hitY = moveBox(v, { dx: 0, dy: 0 }, { snap: 0.001, snapY: 0.02 });
    expect(hitY.guides.some((g) => g.axis === "y")).toBe(true);
    const missY = moveBox(v, { dx: 0, dy: 0 }, { snap: 0.02, snapY: 0.01 });
    expect(missY.guides.some((g) => g.axis === "y")).toBe(false);
  });

  it("sans snapY, un seul seuil sert aux deux axes (comportement d'avant)", () => {
    const v = { x: 0.2, y: 0.3 - 0.015, w: 0.4, h: 0.4 };
    const hit = moveBox(v, { dx: 0, dy: 0 }, { snap: 0.02 });
    expect(hit.guides.some((g) => g.axis === "y")).toBe(true);
  });

  it("resizeBox : le bord bas s'aimante avec snapY", () => {
    const r = resizeBox(
      { x: 0.2, y: 0.2, w: 0.4, h: 0.2 },
      "s",
      { dx: 0, dy: 0.085 },
      { snap: 0.001, snapY: 0.02 },
    );
    expect(r.guides).toContainEqual({ axis: "y", at: 0.5, kind: "center" });
  });
});
