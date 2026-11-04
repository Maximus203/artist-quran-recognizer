import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DockBelow } from "./dock-below";
import { ElementNote } from "./text-sections";

/**
 * Le bas du plateau (recette QA, M1 et m4). Rien de choisi : l'encart « déjà prête ». Un élément choisi : ce qu'il
 * faut savoir de lui (cadenas de l'arabe, attribution de la traduction). Les deux occupent LA MÊME place, pour
 * que la scène ne bouge pas quand on touche un élément.
 */

const noop = () => undefined;
const exportAction = {
  label: "Exporter",
  summary: "1 vidéo",
  disabled: false,
  onOpen: noop,
};
const below = (selected: Parameters<typeof DockBelow>[0]["selected"]) =>
  renderToStaticMarkup(
    <DockBelow
      selected={selected}
      attribution="QuranEnc.com — fixture"
      exportAction={exportAction}
    />,
  );

describe("ce que dit le plateau de l'élément choisi", () => {
  it("l'arabe : le cadenas et « jamais modifiable » (I1)", () => {
    const html = below("arabic");
    expect(html).toContain('data-testid="arabic-lock"');
    expect(html).toContain("jamais le modifier");
    expect(html).not.toContain('data-testid="translation-attribution"');
  });

  it("la traduction : restituée telle quelle, avec son attribution collée à elle (I2)", () => {
    const html = below("translation");
    expect(html).toContain('data-testid="translation-attribution"');
    expect(html).toContain("restituée telle quelle");
    expect(html).toContain("QuranEnc.com — fixture");
    expect(html).not.toContain('data-testid="arabic-lock"');
  });

  it("sans attribution connue, la source reste nommée", () => {
    const html = renderToStaticMarkup(
      <ElementNote id="translation" attribution={null} />,
    );
    expect(html).toContain("QuranEnc.com");
  });

  it("l'onde et le repère disent ce qu'ils sont, sans cadenas ni attribution", () => {
    for (const id of ["wave", "ref"] as const) {
      const html = below(id);
      expect(html).toContain('data-testid="element-role"');
      expect(html).not.toContain('data-testid="arabic-lock"');
      expect(html).not.toContain('data-testid="translation-attribution"');
    }
  });

  it("aucune phrase ne laisse croire que l'arabe se saisit (I1) : pas de champ de texte", () => {
    for (const id of ["arabic", "translation", "wave", "ref"] as const)
      expect(below(id)).not.toMatch(/<(input|textarea)/);
  });
});

describe("la place du bas du plateau ne change pas quand on touche un élément", () => {
  it("rien de choisi : l'encart « déjà prête » est actif, la note est vide", () => {
    const html = below(null);
    expect(html).toContain('data-testid="editor-ready"');
    expect(html).toContain('data-testid="ready-export"');
    expect(html).not.toMatch(/data-testid="editor-ready"[^>]*inert/);
    expect(html).not.toContain('data-testid="arabic-lock"');
  });

  it("un élément choisi : l'encart reste dans la même case, mais invisible et inatteignable", () => {
    const html = below("arabic");
    expect(html).toMatch(/data-testid="editor-ready"[^>]*inert=""/);
    expect(html).toMatch(/data-testid="editor-ready"[^>]*aria-hidden="true"/);
  });

  it("les deux sont empilés dans une seule case de la grille (la plus haute décide)", () => {
    const css = readFileSync(
      path.join(process.cwd(), "app", "export-editor.css"),
      "utf8",
    );
    expect(css).toMatch(/\.xe-below\s*\{[^}]*display:\s*grid/);
    expect(css).toMatch(/\.xe-below\s*>\s*\*\s*\{[^}]*grid-area:\s*1\s*\/\s*1/);
    expect(css).toMatch(
      /\.xe-below\s*>\s*\[data-off\]\s*\{[^}]*visibility:\s*hidden/,
    );
  });
});
