import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Le plancher de l'aperçu (recette QA 2, N1). Le rendu est PROUVÉ au vrai navigateur (Chrome tactile, 360 × 640 à
 * 430 × 932 et paysage, avec et sans lecteur réduit : `e2e/stage-floor.mjs`) ; ces gardes empêchent qu'une retouche
 * des feuilles de style rende de nouveau la place de l'aperçu à ce que les commandes n'ont pas pris.
 *
 * Le principe : l'aperçu est ce qu'on manipule. Sa taille ne descend JAMAIS sous un plancher (un cadre de 160 px de haut,
 * soit 284 × 160 en 16:9) ; quand la place manque, ce sont les commandes qui défilent, pas lui.
 */
const read = (file: string) =>
  readFileSync(path.join(process.cwd(), "app", file), "utf8");
const editor = read("export-editor.css");
const steps = read("export-steps.css");
const compact = read("export-compact.css");
const table = read("export-table.css");

/** La valeur en pixels d'un jeton `--nom: 160px`. */
const px = (css: string, name: string): number => {
  const match = new RegExp(`${name}:\\s*(\\d+)px`).exec(css);
  if (!match) throw new Error(`jeton ${name} introuvable`);
  return Number(match[1]);
};

describe("le plancher de l'aperçu", () => {
  it("un cadre de 160 px de haut au moins (284 × 160 en 16:9), plus un peu moins en paysage", () => {
    expect(px(editor, "--xe-stage-h-min")).toBeGreaterThanOrEqual(160);
    // Une zone d'aperçu = le cadre + la marge des poignées + la rangée de lecture : le plancher les additionne.
    expect(editor).toMatch(
      /--xe-stage-area-min:\s*calc\(\s*var\(--xe-stage-h-min\)\s*\+\s*var\(--xe-halo\)\s*\+\s*var\(--xe-halo-bottom\)\s*\+\s*var\(--xe-transport-h\)\s*\)/,
    );
    expect(compact).toMatch(/--xe-stage-h-min:\s*140px/);
  });

  it("la marge des poignées est la même que celle du cadre (un seul endroit)", () => {
    expect(editor).toMatch(
      /\.xe-stage-host\s*\{[^}]*padding:\s*var\(--xe-halo\) var\(--xe-halo\) var\(--xe-halo-bottom\)/,
    );
  });

  it("le plateau et la table : la zone d'aperçu a le plancher, les commandes rétrécissent et défilent", () => {
    expect(editor).toMatch(
      /\.xe-plateau\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(var\(--xe-stage-area-min\),\s*1fr\)\s+minmax\(\s*0,\s*auto\s*\)/,
    );
    expect(editor).toMatch(
      /\.xe-dock\s*\{[^}]*min-height:\s*0[^}]*overflow-y:\s*auto/,
    );
    // Sous la hauteur qui garde le plancher ET les commandes, la page défile : l'éditeur ne s'écrase pas.
    expect(editor).toMatch(
      /\.xe-plateau\s*\{[^}]*min-height:\s*calc\(\s*var\(--xe-top-h\)\s*\+\s*var\(--xe-stage-area-min\)\s*\+\s*var\(--xe-dock-min\)\s*\)/,
    );
  });

  it("le pas à pas : l'aperçu garde le plancher, la fenêtre de contenu aussi (N5)", () => {
    expect(steps).toMatch(
      /\.xp-stage\s*\{[^}]*height:\s*clamp\(var\(--xe-stage-area-min\)/,
    );
    expect(steps).toMatch(
      /\.xp-stage\[data-step="textes"\]\s*\{[^}]*height:\s*clamp\(var\(--xe-stage-area-min\)/,
    );
    expect(px(steps, "--xp-body-min")).toBeGreaterThanOrEqual(160);
    expect(steps).toMatch(
      /\.xp-root\s*\{[^}]*grid-template-rows:\s*auto auto minmax\(var\(--xp-panel-min\), 1fr\)/,
    );
    // « Suivant » reste sous le pouce, au-dessus du lecteur, même quand la page défile.
    expect(steps).toMatch(
      /\.xp-foot\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*var\(--mini-reserve\)/,
    );
  });

  it("paysage : l'aperçu à gauche a son plancher, comme les commandes à droite", () => {
    expect(compact).toMatch(
      /grid-template-rows:\s*auto minmax\(var\(--xe-stage-area-min\), 1fr\)/,
    );
  });

  it("le rail de la table reste collé en bas de la colonne des commandes, sans cacher ce qu'on atteint", () => {
    expect(table).toMatch(
      /\.xt-rail\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/,
    );
    expect(table).toMatch(
      /\.xt-dock\s*\{[^}]*scroll-padding-bottom:\s*var\(--xt-rail-h\)/,
    );
  });

  it("l'aide de la table n'est plus posée en flottant au-dessus des commandes (elle masquait l'aperçu)", () => {
    const help = /\.xt-help\s*\{[^}]*\}/.exec(table)?.[0] ?? "";
    expect(help).not.toMatch(/position:\s*absolute/);
  });
});

describe("la table sur un écran court garde de la place pour son panneau (N1)", () => {
  it("un panneau du cadre ouvert efface la chronologie (sauf « Fond ») et le rail passe sur une rangée", () => {
    expect(compact).toMatch(
      /@media \(max-width: 519px\) and \(max-height: 880px\),\s*\(orientation: landscape\) and \(max-height: 520px\) and \(max-width: 1023px\)\s*\{[\s\S]*?\.xt\[data-mode="compact"\]:not\(\[data-tool="fond"\]\) \.xt-tl\s*\{[^}]*display:\s*none/,
    );
    expect(compact).toMatch(
      /\.xt:not\(\[data-mode="idle"\]\) \.xt-rail \.xe-tb\s*\{[^}]*repeat\(7, minmax\(0, 1fr\)\)/,
    );
    // Chaque outil garde sa cible tactile de 44 px (`--hit`), icône seule.
    expect(compact).toMatch(
      /\.xt:not\(\[data-mode="idle"\]\) \.xt-rail \.xe-tool\s*\{[^}]*min-height:\s*var\(--hit\)/,
    );
  });

  it("l'éditeur dit quel outil du cadre est ouvert (`data-tool`), pour que la règle ci-dessus puisse le lire", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "app",
        "atelier",
        "export",
        "editor",
        "table-editor.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(/data-tool=\{frameTool \?\? undefined\}/);
  });
});

describe("les pastilles du plateau tiennent dans l'écran (N4)", () => {
  it("cinq colonnes égales sous 520 px, sans défilement caché", () => {
    expect(compact).toMatch(
      /@media \(max-width: 519px\)\s*\{[\s\S]*?\.xe-chips\s*\{[^}]*display:\s*grid[^}]*repeat\(5, minmax\(0, 1fr\)\)[^}]*overflow:\s*visible/,
    );
  });
});

describe("le lecteur réduit ne mange plus l'aperçu (N1)", () => {
  it("la page de l'éditeur lui garde sa place SOUS l'éditeur, pas dans sa hauteur utile", () => {
    expect(editor).toMatch(
      /\.ex-xp-wrap:has\(> \.ex-xp\[data-tab="video"\]:not\(\[data-failed\]\)\)\s*\{[^}]*padding-bottom:\s*var\(--mini-reserve\)/,
    );
  });

  it("l'éditeur du téléphone efface le lecteur réduit le temps qu'il est là", () => {
    const source = readFileSync(
      path.join(
        process.cwd(),
        "app",
        "atelier",
        "export",
        "editor",
        "export-editor.tsx",
      ),
      "utf8",
    );
    expect(source).toMatch(/useHideMiniPlayer\(!desktop\)/);
  });
});
