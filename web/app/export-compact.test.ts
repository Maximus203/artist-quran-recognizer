import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Petits écrans (recette QA, m6). Le rendu est prouvé au vrai navigateur (360 px, paysage 667 × 375) ; ces gardes
 * empêchent qu'une retouche des feuilles de style remette une commande derrière un défilement caché.
 */
const read = (file: string) =>
  readFileSync(path.join(process.cwd(), "app", file), "utf8");
const css = read("export-compact.css");

describe("les éditeurs d'export sur petits écrans", () => {
  it("la feuille est chargée après celles des éditeurs qu'elle corrige", () => {
    const layout = read("layout.tsx");
    const at = (name: string) => layout.indexOf(`./${name}.css`);
    expect(at("export-compact")).toBeGreaterThan(at("export-steps"));
    expect(at("export-compact")).toBeGreaterThan(at("export-table"));
    expect(at("export-compact")).toBeGreaterThan(at("export-editor"));
  });

  it("largeur réduite : barre d'outils et rail passent à la ligne au lieu de défiler", () => {
    expect(css).toMatch(/@media \(max-width: 519px\)/);
    // La colonne étroite du paysage (295 px) a la même règle que l'écran étroit.
    expect(css).toMatch(
      /@media \(max-width: 519px\),\s*\(orientation: landscape\) and \(max-height: 520px\)/,
    );
    expect(css).toMatch(
      /\.xe-tools \.xe-tb,\s*\.xt-rail \.xe-tb\s*\{[^}]*display:\s*grid[^}]*repeat\(auto-fit/,
    );
    expect(css).toMatch(/\.xe-tools \.xe-tb,[^{]*\{[^}]*overflow:\s*visible/);
  });

  it("l'état « rien de choisi » garde la hauteur de celui d'un élément (la scène ne bouge pas)", () => {
    expect(css).toMatch(
      /\.xe-tools\s*\{[^}]*min-height:\s*var\(--xe-tools-h-narrow\)/,
    );
  });

  it("paysage : aperçu à gauche, commandes à droite, rail collé en bas", () => {
    expect(css).toMatch(
      /@media \(orientation: landscape\) and \(max-height: 520px\) and \(max-width: 1023px\)/,
    );
    expect(css).toMatch(
      /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    );
    expect(css).toMatch(
      /\.xt-rail\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/,
    );
  });

  it("aucune couleur ni valeur de jeton redéfinie dans la feuille (tout vient de tokens.css)", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toMatch(/\brgb\(|\bhsl\(/);
  });
});
