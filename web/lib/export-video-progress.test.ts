import { describe, expect, it } from "vitest";
import {
  applyFileProgress,
  failFile,
  fileProgressText,
  initialFiles,
  progressCounts,
} from "./export-video-progress";

describe("progression par fichier", () => {
  it("se dit « Vidéo 2/5 : rendu 64 % » (lisible par l'API comme par l'écran)", () => {
    expect(
      fileProgressText({ index: 1, total: 5, phase: "render", ratio: 0.64 }),
    ).toBe("Vidéo 2/5 : rendu 64 %");
    expect(
      fileProgressText({ index: 0, total: 1, phase: "send", ratio: 0.5 }),
    ).toBe("Vidéo 1/1 : assemblage 50 %");
    expect(
      fileProgressText({ index: 4, total: 5, phase: "done", ratio: 1 }),
    ).toBe("Vidéo 5/5 : prête");
  });

  it("met à jour la ligne du fichier et laisse les autres en attente", () => {
    let rows = initialFiles(["a.mp4", "b.mp4", "c.mp4"]);
    rows = applyFileProgress(rows, {
      index: 0,
      total: 3,
      phase: "done",
      ratio: 1,
      bytes: 2048,
    });
    rows = applyFileProgress(rows, {
      index: 1,
      total: 3,
      phase: "render",
      ratio: 0.3,
    });
    expect(rows.map((r) => r.state)).toEqual(["done", "run", "wait"]);
    expect(rows[0].bytes).toBe(2048);
    // Rendu = 90 % du travail d'un fichier, l'assemblage les 10 % restants.
    expect(rows[1].ratio).toBeCloseTo(0.27);
    expect(progressCounts(rows)).toEqual({ done: 1, total: 3 });
  });

  it("un échec marque le fichier en erreur sans toucher aux fichiers déjà prêts", () => {
    const rows = failFile(
      applyFileProgress(initialFiles(["a", "b"]), {
        index: 0,
        total: 2,
        phase: "done",
        ratio: 1,
      }),
      1,
    );
    expect(rows.map((r) => r.state)).toEqual(["done", "err"]);
  });

  it("ignore un index hors liste", () => {
    const rows = initialFiles(["a"]);
    expect(
      applyFileProgress(rows, { index: 4, total: 1, phase: "done", ratio: 1 }),
    ).toBe(rows);
  });
});
