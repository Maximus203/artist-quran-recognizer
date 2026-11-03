import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EDITOR_MODES } from "@/lib/export-editor-mode";
import { EditorModeCards } from "./mode-cards";
import { EditorModeDialog } from "./mode-dialog";
import { ModeDemo } from "./mode-demo";
import { MODE_INFO, modeInfo } from "./mode-info";

/**
 * Le choix du format, vérifié sur le HTML : une explication claire par format, une animation qui a toujours son
 * équivalent lisible sans mouvement, une cible par format, jamais l'arabe du Coran en démonstration (I1).
 * Le mouvement, le focus et le clavier se prouvent au vrai navigateur (voir la note de livraison).
 */

const noop = () => undefined;

describe("les explications des trois formats", () => {
  it("un texte pour chacun : nom, phrase du monteur, ce que ça donne, pour qui", () => {
    for (const mode of EDITOR_MODES) {
      const info = modeInfo(mode);
      expect(info.name.length).toBeGreaterThan(2);
      expect(info.quote).toMatch(/^«.+»$/);
      expect(info.what.length).toBeGreaterThan(30);
      expect(info.who.length).toBeGreaterThan(15);
      expect(info.frames).toHaveLength(3);
      for (const frame of info.frames) expect(frame.length).toBeGreaterThan(5);
    }
  });

  it("les phrases validées par le mainteneur", () => {
    expect(MODE_INFO.plateau.quote).toBe(
      "« Je touche ce que je veux changer. »",
    );
    expect(MODE_INFO.table.quote).toBe(
      "« Je règle avec une chronologie, comme un monteur. »",
    );
    expect(MODE_INFO.pas.quote).toBe("« On me guide en trois étapes. »");
    expect(MODE_INFO.plateau.name).toBe("Plateau");
    expect(MODE_INFO.table.name).toBe("Table de montage");
    expect(MODE_INFO.pas.name).toBe("Pas à pas");
  });

  it("aucun texte arabe : le Coran ne vient que du corpus", () => {
    const all = JSON.stringify(MODE_INFO);
    expect(all).not.toMatch(/[؀-ۿ]/);
  });

  it("le texte alternatif raconte les trois temps, sans l'animation", () => {
    for (const mode of EDITOR_MODES) {
      const info = modeInfo(mode);
      for (const frame of info.frames) expect(info.alt).toContain(frame);
    }
  });
});

describe("l'animation d'un format", () => {
  for (const mode of EDITOR_MODES) {
    it(`${mode} : une version animée décrite, et trois images fixes lisibles`, () => {
      const html = renderToStaticMarkup(<ModeDemo mode={mode} />);
      const info = modeInfo(mode);
      // L'animation : une seule image « role=img » avec son texte alternatif ; le dessin lui-même est muet.
      expect(html).toContain('role="img"');
      expect(html).toContain(
        `aria-label="${info.alt.replace(/'/g, "&#x27;")}"`,
      );
      expect((html.match(/mdemo__live/g) ?? []).length).toBeGreaterThan(0);
      // Le repli sans mouvement : trois images fixes, chacune avec sa légende en vrai texte.
      expect((html.match(/mdemo--still/g) ?? []).length).toBe(3);
      for (const frame of info.frames)
        expect(html.replace(/&#x27;/g, "'")).toContain(frame);
      // Les dessins n'ont aucun texte lisible par les aides techniques.
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toContain("<text");
    });
  }

  it("chaque image fixe gèle l'animation à un instant différent", () => {
    const html = renderToStaticMarkup(<ModeDemo mode="plateau" />);
    const delays = [...html.matchAll(/--t:(-?[\d.]+s)/g)].map((m) => m[1]);
    expect(delays).toHaveLength(3);
    expect(new Set(delays).size).toBe(3);
  });
});

describe("les trois formats à choisir (fenêtre et paramètres)", () => {
  const render = (current: string | null = null) =>
    renderToStaticMarkup(
      <EditorModeCards current={current as never} onChoose={noop} />,
    );

  it("une carte par format, dans l'ordre, chacune avec son bouton d'un seul geste", () => {
    const html = render();
    for (const mode of EDITOR_MODES) {
      expect(html).toContain(`data-testid="mode-card-${mode}"`);
      expect(html).toContain(`data-testid="mode-pick-${mode}"`);
      expect(html).toContain(modeInfo(mode).quote);
      expect(html).toContain(modeInfo(mode).what);
      expect(html).toContain(modeInfo(mode).who);
    }
    expect(html.indexOf("mode-card-plateau")).toBeLessThan(
      html.indexOf("mode-card-table"),
    );
    expect(html.indexOf("mode-card-table")).toBeLessThan(
      html.indexOf("mode-card-pas"),
    );
  });

  it("le bouton nomme son format (lecteur d'écran) et rien n'est coché d'avance à la première question", () => {
    const html = render();
    expect(html).toContain("Choisir le format Plateau");
    expect(html).toContain("Choisir le format Table de montage");
    expect(html).toContain("Choisir le format Pas à pas");
    expect(html).not.toContain('data-current="true"');
  });

  it("dans les paramètres, le format actuel est marqué et son bouton ne propose plus rien", () => {
    const html = render("table");
    expect(html).toContain('data-current="true"');
    expect((html.match(/data-current="true"/g) ?? []).length).toBe(1);
    expect(html).toMatch(
      /data-testid="mode-card-table"[^>]*data-current="true"/,
    );
    expect(html).toContain("Format actuel");
    // Les deux autres restent à un geste.
    expect(html).toContain("Choisir le format Plateau");
    expect(html).toContain("Choisir le format Pas à pas");
    expect(html).not.toContain("Choisir le format Table de montage");
  });

  it("un bouton pour mettre les animations en pause (accessibilité)", () => {
    const html = render();
    expect(html).toContain('data-testid="mode-pause"');
    expect(html).toContain('aria-pressed="false"');
  });
});

describe("la fenêtre de la première ouverture", () => {
  const html = renderToStaticMarkup(
    <EditorModeDialog onChoose={noop} onLater={noop} />,
  );

  it("une vraie fenêtre : modale, nommée, décrite", () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("aria-describedby=");
    expect(html).toContain('data-testid="mode-dialog"');
  });

  it("pose la question simplement et rassure : on pourra changer dans le compte", () => {
    expect(html).toContain("Comment veux-tu régler ta vidéo");
    expect(html).toMatch(/Compte/);
  });

  it("propose les trois formats et « choisir plus tard »", () => {
    for (const mode of EDITOR_MODES)
      expect(html).toContain(`data-testid="mode-pick-${mode}"`);
    expect(html).toContain('data-testid="mode-later"');
    expect(html).toContain("Choisir plus tard");
  });
});
