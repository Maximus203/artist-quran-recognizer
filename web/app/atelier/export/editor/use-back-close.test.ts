import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tout ce qui s'ouvre « par-dessus » l'éditeur sur téléphone se ferme avec le bouton Retour du navigateur
 * (recette QA, m3). La logique d'historique est testée dans `lib/back-close.test.ts` ; ici, on garde que chaque
 * endroit qui ouvre une feuille ou une fenêtre l'a bien branchée (un nouvel éditeur à feuille l'oublierait en silence).
 */
const read = (file: string) =>
  readFileSync(
    path.join(process.cwd(), "app", "atelier", "export", "editor", file),
    "utf8",
  );

describe("Retour ferme la feuille ouverte", () => {
  it.each([
    ["plateau-mobile.tsx", /useBackClose\(\s*tool !== null,\s*closeTool\s*\)/],
    ["table-editor.tsx", /useBackClose\(\s*tool !== null,\s*closePanel\s*\)/],
    ["frame-sections.tsx", /useBackClose\(\s*open,\s*onClose\s*\)/],
  ])("%s branche useBackClose sur sa feuille", (file, pattern) => {
    expect(read(file)).toMatch(pattern);
  });

  it("la fenêtre-résumé de l'export ferme avec Retour avant de quitter l'export (recette QA 2, N3)", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "app",
        "atelier",
        "export",
        "video-bordereau.tsx",
      ),
      "utf8",
    );
    const sheet = source.slice(source.indexOf("export function ExportSheet"));
    expect(sheet).toMatch(/useBackClose\(\s*open,\s*onClose\s*\)/);
    // Le crochet est posé AVANT le retour anticipé `if (!open) return null` : l'ordre des crochets ne change pas.
    expect(sheet.indexOf("useBackClose(")).toBeLessThan(
      sheet.indexOf("if (!open) return null"),
    );
  });
});
