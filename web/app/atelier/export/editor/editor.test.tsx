import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LAYOUTS,
  DEFAULT_STYLES,
  type BlockId,
} from "@/lib/export-video-model";
import { DEFAULT_VIDEO_PREFS } from "@/lib/export-video-prefs";
import { EditOverlay } from "./edit-overlay";
import { editorFor, EDITORS } from "./editor-registry";
import {
  DEFAULT_EDITOR_MODE,
  EDITOR_MODES,
  isEditorMode,
  type EditorProps,
} from "./editor-types";
import { ExportEditor } from "./export-editor";
import { BackgroundSection } from "./frame-sections";
import { PlateauEditor } from "./plateau-mobile";
import {
  ArabicLockNote,
  ElementHeader,
  PanelSection,
  PositionSection,
  SizeSection,
  WaveSizeSection,
} from "./text-sections";

/**
 * Ce que l'éditeur rend, vérifié sur le HTML lui-même : qui est monté pour quel mode, ce que porte le calque,
 * ce que disent les sections (I1 : l'arabe n'a jamais de champ ; I2 : la traduction garde son attribution).
 * Les gestes sont testés sans DOM dans `lib/export-video-gesture.test.ts` et au vrai navigateur.
 */

const noop = () => undefined;
const layout = DEFAULT_LAYOUTS["16:9"];
const allVisible = { ref: true, arabic: true, translation: true, wave: true };

function overlay(
  props: Partial<Parameters<typeof EditOverlay>[0]> = {},
): string {
  return renderToStaticMarkup(
    <EditOverlay
      layout={layout}
      visible={allVisible}
      selected={null}
      sizes={{ ref: 1, arabic: 1, translation: 1 }}
      onSelect={noop}
      onBox={noop}
      onSize={noop}
      {...props}
    />,
  );
}

describe("les éditeurs et leur registre", () => {
  it("trois modes, le plateau d'abord", () => {
    expect(EDITOR_MODES).toEqual(["plateau", "table", "pas"]);
    expect(DEFAULT_EDITOR_MODE).toBe("plateau");
    expect(isEditorMode("table")).toBe(true);
    expect(isEditorMode("bureau")).toBe(false);
    expect(isEditorMode(undefined)).toBe(false);
  });

  it("le plateau est enregistré ; un mode sans éditeur retombe sur lui", () => {
    expect(EDITORS.plateau).toBe(PlateauEditor);
    expect(editorFor("plateau")).toBe(PlateauEditor);
    expect(editorFor("table")).toBe(PlateauEditor);
    expect(editorFor("pas")).toBe(PlateauEditor);
  });
});

describe("le calque d'édition", () => {
  it("une zone par élément affiché, nommée et atteignable au clavier", () => {
    const html = overlay();
    for (const id of ["arabic", "translation", "wave", "ref"] as BlockId[]) {
      expect(html).toContain(`data-testid="zone-${id}"`);
    }
    expect(html).toMatch(/aria-label="Texte arabe\. Flèches : déplacer/);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('role="status" aria-live="polite"');
  });

  it("un élément masqué n'a plus de zone", () => {
    const html = overlay({ visible: { ...allVisible, translation: false } });
    expect(html).not.toContain('data-testid="zone-translation"');
    expect(html).toContain('data-testid="zone-arabic"');
  });

  it("rien de choisi : ni cadre de sélection ni poignées", () => {
    const html = overlay();
    expect(html).not.toContain("edit-selection");
    expect(html).not.toContain("data-handle");
  });

  it("l'élément choisi montre son étiquette et ses poignées", () => {
    // Le calque n'est pas mesuré en rendu statique : seuls les quatre coins ont de la place ; les huit
    // poignées d'une grande boîte sont vérifiées par `handlePlacements` et au vrai navigateur.
    const html = overlay({ selected: "translation" });
    expect(html).toContain('data-testid="edit-selection"');
    expect(html).toContain("Traduction");
    for (const handle of ["nw", "ne", "sw", "se"])
      expect(html).toContain(`data-handle="${handle}"`);
    expect(html).toContain('aria-pressed="true"');
  });

  it("dit la réduction du texte à sa zone dans l'étiquette, et une zone trop petite", () => {
    const reduced = overlay({
      selected: "arabic",
      fit: { arabic: { note: "réduit à 87 %", overflow: false } },
    });
    expect(reduced).toContain("réduit à 87 %");
    const tooSmall = overlay({
      selected: "arabic",
      fit: { arabic: { note: "réduit à 40 %", overflow: true } },
    });
    expect(tooSmall).toContain("zone trop petite");
  });

  it("signale aux lecteurs d'écran les éléments qui se chevauchent", () => {
    const stacked = {
      ...layout,
      translation: { x: 0.08, y: 0.5, w: 0.84, h: 0.2 },
    };
    const html = overlay({ layout: stacked });
    expect(html).toContain("Plusieurs éléments se chevauchent ici");
    expect(overlay()).not.toContain("Plusieurs éléments se chevauchent ici");
  });

  it("une boîte étroite écarte ses poignées vers l'extérieur (jamais deux sur la même cible)", () => {
    const html = overlay({ selected: "ref" });
    expect(html).toContain("translate(calc(-50% +");
  });

  it("l'aide du premier affichage désigne un élément", () => {
    expect(overlay({ coach: "arabic" })).toContain("xe-coach");
    expect(overlay()).not.toContain("xe-coach");
  });

  it("hors service : les zones ne prennent plus le clavier", () => {
    expect(overlay({ disabled: true })).toContain('tabindex="-1"');
  });
});

describe("les sections de réglages", () => {
  it("le texte arabe : cadenas et phrase, jamais un champ de saisie (I1)", () => {
    const header = renderToStaticMarkup(
      <ElementHeader id="arabic" canHide onHide={noop} />,
    );
    expect(header).toContain("jamais modifiable");
    const note = renderToStaticMarkup(<ArabicLockNote />);
    expect(note).toContain("jamais le modifier");
    expect(note).not.toContain("<input");
    expect(note).not.toContain("<textarea");
  });

  it("la traduction ne se montre pas sans son attribution (I2)", () => {
    const html = renderToStaticMarkup(
      <ElementHeader
        id="translation"
        attribution="QuranEnc.com — Hamidullah"
        canHide
        onHide={noop}
      />,
    );
    expect(html).toContain("QuranEnc.com — Hamidullah");
    const fallback = renderToStaticMarkup(
      <ElementHeader id="translation" canHide onHide={noop} />,
    );
    expect(fallback).toContain("QuranEnc.com");
  });

  it("masquer est refusé pour la dernière écriture, avec la raison", () => {
    const html = renderToStaticMarkup(
      <ElementHeader id="arabic" canHide={false} onHide={noop} />,
    );
    expect(html).toMatch(/disabled=""/);
    expect(html).toContain("Une des deux écritures reste affichée");
  });

  it("la taille : − 100 % +, aucun « petit / moyen / grand »", () => {
    const html = renderToStaticMarkup(
      <SizeSection
        block="arabic"
        size={1}
        onStep={() => true}
        onReset={noop}
      />,
    );
    expect(html).toContain("100 %");
    expect(html).toContain('aria-label="Texte plus petit"');
    expect(html).toContain('aria-label="Texte plus grand"');
    expect(html).not.toMatch(/petit<|moyen|grand</i);
    expect(html).toContain("pincer");
  });

  it("la taille au maximum désactive « + », au minimum « − »", () => {
    const max = renderToStaticMarkup(
      <SizeSection
        block="arabic"
        size={5}
        onStep={() => true}
        onReset={noop}
      />,
    );
    expect(max).toMatch(/aria-label="Texte plus grand" disabled=""/);
    const min = renderToStaticMarkup(
      <SizeSection
        block="arabic"
        size={0.4}
        onStep={() => true}
        onReset={noop}
      />,
    );
    expect(min).toMatch(/aria-label="Texte plus petit" disabled=""/);
  });

  it("la hauteur de l'onde n'a pas de pourcentage de texte", () => {
    const html = renderToStaticMarkup(
      <WaveSizeSection box={layout.wave} onStep={() => true} />,
    );
    expect(html).toContain("Hauteur de l’onde");
    expect(html).toContain("22 %");
  });

  it("le fond du texte : quatre choix, celui du style est coché, chaque texte le sien", () => {
    const html = renderToStaticMarkup(
      <PanelSection
        block="translation"
        panel={{ ...DEFAULT_STYLES.translation.panel, kind: "blur" }}
        onChange={noop}
      />,
    );
    for (const kind of ["none", "transparent", "blur", "solid"])
      expect(html).toContain(`data-testid="panel-${kind}"`);
    expect(html).toMatch(/aria-checked="true"[^>]*data-testid="panel-blur"/);
    expect(html).toContain("Aucun fond");
    expect(html).toContain("Flou");
    // Fond flou : couleur, transparence, arrondi.
    expect(html).toContain("Couleur du fond");
    expect(html).toContain("Transparence");
    expect(html).toContain("Arrondi des angles");
  });

  it("sans fond : ombre douce ou contour, pas de couleur", () => {
    const html = renderToStaticMarkup(
      <PanelSection
        block="arabic"
        panel={{ ...DEFAULT_STYLES.arabic.panel, kind: "none" }}
        onChange={noop}
      />,
    );
    expect(html).toContain("Ombre douce");
    expect(html).toContain("Contour noir");
    expect(html).not.toContain("Couleur du fond");
  });

  it("le fond plein est toujours opaque : pas de réglage de transparence", () => {
    const html = renderToStaticMarkup(
      <PanelSection
        block="arabic"
        panel={{ ...DEFAULT_STYLES.arabic.panel, kind: "solid" }}
        onChange={noop}
      />,
    );
    expect(html).not.toContain("Transparence");
    expect(html).toContain("Arrondi des angles");
  });

  it("la position : croix directionnelle, quatre champs, centrer, remettre", () => {
    const html = renderToStaticMarkup(
      <PositionSection
        box={layout.arabic}
        onNudge={() => true}
        onField={noop}
        onCenter={noop}
        onReset={noop}
      />,
    );
    for (const key of ["ArrowUp", "ArrowLeft", "ArrowRight", "ArrowDown"])
      expect(html).toContain(`data-testid="nudge-${key}"`);
    for (const field of ["left", "top", "width", "height"])
      expect(html).toContain(`data-testid="field-${field}"`);
    expect(html).toContain("Gauche");
    expect(html).toContain("Largeur");
    expect(html).toContain("Centrer dans l’image");
    expect(html).toContain("Remettre à la place d’origine");
  });
});

describe("l'emplacement du fond vidéo", () => {
  const frame = {
    isVideo: false,
    sourceSize: null,
    sourceUnreadable: false,
    previewUnavailable: false,
    selectedBg: "auto",
    upload: null,
    uploadThumb: null,
    onUpload: noop,
    onChooseBg: noop,
  };
  it("la section Fond y montre ce que la phase du fond vidéo lui donne", () => {
    const html = renderToStaticMarkup(
      <BackgroundSection
        prefs={DEFAULT_VIDEO_PREFS}
        patch={noop}
        frame={{ ...frame, backgroundVideo: <p data-testid="slot">vidéo</p> }}
      />,
    );
    expect(html).toContain('data-testid="slot"');
  });
  it("sans elle, rien n'est affiché à la place", () => {
    const html = renderToStaticMarkup(
      <BackgroundSection
        prefs={DEFAULT_VIDEO_PREFS}
        patch={noop}
        frame={frame}
      />,
    );
    expect(html).not.toContain('data-testid="slot"');
  });
});

describe("ExportEditor (le contrat d'intégration)", () => {
  const props = (): EditorProps => ({
    sessionId: "s1",
    title: "Récitation du vendredi",
    subtitle: "4 passages · 20 s",
    prefs: DEFAULT_VIDEO_PREFS,
    patch: vi.fn(),
    preview: {
      intervals: null,
      peaks: null,
      upload: null,
      isVideo: false,
      sourceSize: null,
    },
    frame: {
      isVideo: false,
      sourceSize: null,
      sourceUnreadable: false,
      previewUnavailable: false,
      selectedBg: "auto",
      upload: null,
      uploadThumb: null,
      onUpload: noop,
      onChooseBg: noop,
    },
    passages: {
      summary: "Tout l’audio · 20 s",
      short: "Tout l’audio",
      content: <p>frise</p>,
      count: 1,
    },
    advanced: <p>qualité</p>,
    exportAction: {
      label: "Exporter",
      summary: "1 vidéo",
      disabled: false,
      onOpen: noop,
    },
  });

  it("par défaut le plateau : barre du haut, un seul Exporter, cinq pastilles, outils du cadre", () => {
    const html = renderToStaticMarkup(<ExportEditor {...props()} />);
    expect(html).toContain('data-testid="editor-plateau"');
    expect(html.match(/data-testid="video-export"/g)).toHaveLength(1);
    for (const chip of ["arabic", "translation", "wave", "ref", "frame"])
      expect(html).toContain(`data-testid="chip-${chip}"`);
    for (const tool of ["format", "fond", "passages", "avance"])
      expect(html).toContain(`data-testid="tool-${tool}"`);
    expect(html).toContain('data-testid="editor-ready"');
    expect(html).toContain("Récitation du vendredi");
  });

  it("un mode sans éditeur (table, pas) montre le plateau", () => {
    expect(
      renderToStaticMarkup(<ExportEditor {...props()} mode="table" />),
    ).toContain('data-testid="editor-plateau"');
    expect(
      renderToStaticMarkup(<ExportEditor {...props()} mode="pas" />),
    ).toContain('data-testid="editor-plateau"');
  });

  it("l'export désactivé l'est sur le bouton", () => {
    const base = props();
    const html = renderToStaticMarkup(
      <ExportEditor
        {...base}
        exportAction={{ ...base.exportAction, disabled: true }}
      />,
    );
    expect(html).toMatch(
      /data-testid="video-export"[^>]*disabled|disabled=""[^>]*data-testid="video-export"/,
    );
  });

  it("le bouton retour n'existe que si on peut quitter", () => {
    expect(renderToStaticMarkup(<ExportEditor {...props()} />)).not.toContain(
      "editor-back",
    );
    expect(
      renderToStaticMarkup(<ExportEditor {...props()} onLeave={noop} />),
    ).toContain("editor-back");
  });
});
