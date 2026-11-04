import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Corrections de la recette QA 3 sur la mise en page des éditeurs d'export (P1, P2, P3, P8, P10). Le rendu est PROUVÉ au vrai
 * navigateur (Chrome tactile, 320 à 430 px, paysage, tablettes, bureau : `e2e/stage-floor.mjs` et les mesures du rapport de la
 * PR) ; ces gardes empêchent qu'une retouche des feuilles de style les défasse en silence.
 */
const read = (file: string) =>
  readFileSync(path.join(process.cwd(), "app", file), "utf8");
const editor = read("export-editor.css");
const steps = read("export-steps.css");
const compact = read("export-compact.css");
const tokens = read("tokens.css");
const base = read("base.css");

/** Le corps de la première règle `selector { … }` du CSS. */
const rule = (css: string, selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`règle ${selector} introuvable`);
  return match[1] ?? "";
};

describe("P1 / P10 : la page ne défile jamais plus que son contenu", () => {
  it("les colonnes qui défilent sont positionnées : un élément absolu caché reste DANS leur défilement", () => {
    expect(rule(steps, ".xp-body")).toMatch(/position:\s*relative/);
    expect(rule(editor, ".xe-dock")).toMatch(/position:\s*relative/);
    expect(rule(editor, ".xe-sheet-body")).toMatch(/position:\s*relative/);
  });

  it("la région annoncée du pied de page est fixe : elle ne rallonge pas le document d'un pixel", () => {
    expect(rule(base, ".sr-live")).toMatch(/position:\s*fixed/);
    for (const file of ["atelier/export/export-page.tsx", "atelier/sessions-page.tsx"])
      expect(read(file)).toMatch(/className="sr sr-live"/);
  });
});

describe("P2 : une fenêtre utile suffisante sur écran court", () => {
  it("au-dessous de 760 px de haut la barre du haut, la marge des poignées et le bouton de lecture se serrent", () => {
    expect(editor).toMatch(
      /@media \(max-width: 1023px\) and \(max-height: 760px\)\s*\{\s*:root\s*\{[^}]*--xe-top-pad:\s*var\(--sp-1\)[^}]*--xe-halo:\s*22px[^}]*--xe-play:\s*var\(--hit\)/,
    );
    // Rien ne descend sous la cible tactile de 44 px.
    expect(tokens).toMatch(/--hit:\s*44px/);
    expect(rule(editor, ".xe-play")).toMatch(/width:\s*var\(--xe-play\)/);
    expect(rule(editor, ".xe-top")).toMatch(/padding:\s*var\(--xe-top-pad\)/);
  });

  it("le pas à pas : pastilles et barre Précédent / Suivant se serrent aussi, l'aperçu garde son plancher", () => {
    expect(steps).toMatch(
      /@media \(max-height: 760px\)\s*\{\s*:root\s*\{[^}]*--xp-steps-h:\s*52px[^}]*--xp-foot-h:\s*58px[^}]*--xp-btn-h:\s*48px/,
    );
    expect(rule(steps, ".xp-btn")).toMatch(/min-height:\s*var\(--xp-btn-h\)/);
    // La fenêtre de contenu garde son plancher de 160 px dans la somme.
    expect(steps).toMatch(
      /--xp-panel-min:\s*calc\(var\(--xp-steps-h\) \+ var\(--xp-body-min\) \+ var\(--xp-foot-h\)\)/,
    );
    // 48 px de bouton : encore au-dessus de la cible tactile de 44 px.
    expect(steps).toMatch(/--xp-btn-h:\s*48px/);
  });

  it("à l'étape des textes la phrase d'aide passe après la fiche (la taille − / + remonte)", () => {
    expect(steps).toMatch(
      /@media \(max-height: 760px\)\s*\{[^@]*\.xp-head\[data-compact\]\s*\{\s*display:\s*contents/,
    );
    expect(steps).toMatch(/\.xp-head\[data-compact\] p\s*\{\s*order:\s*9/);
  });

  it("à 320 px les poignées se posent plus près du bord : le cadre garde son plancher de 160 px de haut", () => {
    expect(editor).toMatch(
      /@media \(max-width: 339px\)\s*\{\s*:root\s*\{\s*--xe-halo-x:\s*16px/,
    );
    // 320 − 2 × 16 = 288 de large : 162 de haut en 16:9, au-dessus du plancher (avec 18 px, 284 → 159 : 1 px trop bas).
    expect(Math.floor(((320 - 2 * 16) * 9) / 16)).toBeGreaterThanOrEqual(160);
    expect(rule(editor, ".xe-stage-host")).toMatch(
      /padding:\s*var\(--xe-halo\) var\(--xe-halo-x\) var\(--xe-halo-bottom\)/,
    );
  });
});

describe("P3 : la table profite de la place", () => {
  it("téléphone court : le rail est sur une rangée d'icônes AU REPOS aussi, et chaque outil garde 44 px (même à 320 px)", () => {
    expect(compact).toMatch(
      /@media \(max-width: 519px\) and \(max-height: 700px\)\s*\{\s*\.xt \.xt-rail \.xe-tb\s*\{[^}]*repeat\(7, minmax\(0, 1fr\)\)[^}]*gap:\s*0/,
    );
    expect(compact).toMatch(
      /\.xt \.xt-rail \.xe-tool\s*\{\s*min-height:\s*var\(--hit\)/,
    );
    // 320 px : 7 outils sans espace entre eux ni marge de rail superflue = 44 px chacun.
    expect(compact).toMatch(
      /@media \(max-width: 359px\)\s*\{\s*\.xt:not\(\[data-mode="idle"\]\) \.xt-rail \.xe-tb\s*\{\s*gap:\s*0/,
    );
    expect((320 - 2 * 4) / 7).toBeGreaterThanOrEqual(44);
  });

  it("tablette tenue en large : l'aperçu à gauche, la table à droite, les outils à la ligne", () => {
    expect(compact).toMatch(
      /@media \(orientation: landscape\) and \(min-width: 700px\) and \(min-height: 521px\) and \(max-width: 1023px\)\s*\{\s*\.xt\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/,
    );
    expect(compact).toMatch(/\.xt > \.xe-stage-area\s*\{\s*grid-column:\s*1/);
    expect(compact).toMatch(/\.xt > \.xe-dock\s*\{\s*grid-column:\s*2/);
  });

  it("bureau étroit (1024 à 1199 px) : des colonnes de côté plus étroites rendent de la place à l'aperçu", () => {
    expect(editor).toMatch(
      /@media \(min-width: 1024px\) and \(max-width: 1199px\)\s*\{\s*\.xe-work\s*\{\s*grid-template-columns:\s*208px minmax\(0, 1fr\) 340px/,
    );
  });
});

describe("P8 : une fenêtre modale passe au-dessus du lecteur réduit (une seule échelle de couches)", () => {
  const z = (name: string) => {
    const match = new RegExp(`--${name}:\\s*(\\d+)`).exec(tokens);
    if (!match) throw new Error(`jeton --${name} introuvable`);
    return Number(match[1]);
  };

  it("le voile et la feuille sont devant le lecteur", () => {
    expect(z("z-modal-scrim")).toBeGreaterThan(z("z-player"));
    expect(z("z-modal")).toBeGreaterThan(z("z-modal-scrim"));
  });

  it("le lecteur, le voile et la feuille lisent ces jetons (aucun nombre en dur)", () => {
    expect(rule(read("playlists.css"), ".mini-player")).toMatch(
      /z-index:\s*var\(--z-player\)/,
    );
    const refonte = read("export-refonte.css");
    expect(rule(refonte, ".xr-scrim")).toMatch(
      /z-index:\s*var\(--z-modal-scrim\)/,
    );
    expect(rule(refonte, ".xr-sheet")).toMatch(/z-index:\s*var\(--z-modal\)/);
  });
});
