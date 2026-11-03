import { describe, expect, it } from "vitest";
import {
  BLOCK_LABEL,
  BLOCK_SHORT,
  describePlacement,
  describeSize,
  describeVisibility,
  fitReport,
  sizeLockedBlock,
} from "./export-video-edit-text";
import { BLOCK_IDS } from "./export-video-model";
import type { CardLayout } from "./export-video-layout";

describe("noms des éléments", () => {
  it("chaque bloc a un nom complet et un nom court, en français", () => {
    for (const id of BLOCK_IDS) {
      expect(BLOCK_LABEL[id].length).toBeGreaterThan(2);
      expect(BLOCK_SHORT[id].length).toBeGreaterThan(2);
    }
    expect(BLOCK_SHORT.arabic).toBe("Arabe");
    expect(BLOCK_SHORT.ref).toBe("Verset");
  });
});

describe("annonces des gestes (aria-live)", () => {
  it("dit où est le centre de l'élément et la taille de sa zone, en pourcents", () => {
    expect(
      describePlacement("arabic", { x: 0.08, y: 0.1, w: 0.84, h: 0.4 }),
    ).toBe("Texte arabe : centre à 50 % sur 30 %, zone de 84 % sur 40 %.");
  });

  it("annonce la taille du texte en pourcentage entier", () => {
    expect(describeSize("translation", 1.06)).toBe(
      "Traduction : taille 106 %.",
    );
  });

  it("annonce un élément masqué ou affiché", () => {
    expect(describeVisibility("wave", false)).toBe("Onde sonore masquée.");
    expect(describeVisibility("arabic", true)).toBe("Texte arabe affiché.");
    expect(describeVisibility("translation", false)).toBe(
      "Traduction masquée.",
    );
  });
});

describe("sizeLockedBlock", () => {
  it("l'onde n'a pas de taille de texte", () => {
    expect(sizeLockedBlock("wave")).toBe(true);
    expect(sizeLockedBlock("arabic")).toBe(false);
  });
});

describe("fitReport (« réduit à 87 % » dans l'aperçu)", () => {
  const rect = { x: 0, y: 0, width: 10, height: 10 };
  const card = (
    arabic: { note: string | null; overflow: boolean },
    translation: { note: string | null; overflow: boolean },
  ): CardLayout =>
    ({
      width: 100,
      height: 100,
      ref: null,
      arabic: { ...arabic, fit: 1, box: rect, panel: rect },
      translation: { ...translation, fit: 1, box: rect, panel: rect },
      wave: null,
    }) as unknown as CardLayout;

  it("reprend la note et le débordement de chaque texte présent", () => {
    const report = fitReport(
      card(
        { note: "réduit à 87 %", overflow: false },
        { note: null, overflow: true },
      ),
    );
    expect(report.arabic).toEqual({ note: "réduit à 87 %", overflow: false });
    expect(report.translation).toEqual({ note: null, overflow: true });
    expect(report.ref).toBeUndefined();
  });

  it("sans mise en page, rien à rapporter", () => {
    expect(fitReport(null)).toEqual({});
  });
});
