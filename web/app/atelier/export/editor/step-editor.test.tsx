import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_VIDEO_PREFS, type VideoPrefs } from "@/lib/export-video-prefs";
import { START_PROGRESS, type TextTab } from "@/lib/export-video-steps";
import { editorFor } from "./editor-registry";
import type { EditorProps } from "./editor-types";
import { ExportEditor } from "./export-editor";
import { StepEditor } from "./step-editor";
import { ExportPane, FramePane, ReadyCard, TextsPane } from "./step-panes";
import { useEditorController } from "./use-editor-controller";

/**
 * Ce que le pas à pas rend, vérifié sur le HTML lui-même (pas de DOM dans les tests de ce projet) : quelle
 * étape est montrée, ce que dit chaque étape, ce qui reste monté. La progression, sa mémoire et la garde de
 * navigation sont testées à part, sans DOM (`lib/export-video-steps.test.ts`) ; les gestes et le parcours
 * réel (touchers, mémoire d'un rechargement) au vrai navigateur.
 */

const noop = () => undefined;

const props = (over: Partial<EditorProps> = {}): EditorProps => ({
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
    attribution: "QuranEnc.com — Hamidullah",
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
    backgroundVideo: <p data-testid="slot-video-de-fond">vidéo de fond</p>,
  },
  passages: {
    summary: "Tout l’audio · 20 s",
    short: "Tout l’audio",
    content: <p>frise</p>,
    count: 1,
  },
  advanced: <p data-testid="slot-avance">qualité et poids</p>,
  exportAction: {
    label: "Exporter",
    summary: "1 vidéo",
    disabled: false,
    onOpen: noop,
  },
  ...over,
});

const at = (step: "cadre" | "textes" | "exporter") => ({
  step,
  done:
    step === "cadre"
      ? []
      : step === "textes"
        ? ["cadre" as const]
        : (["cadre", "textes"] as const),
});

const render = (
  step: "cadre" | "textes" | "exporter",
  over: Partial<EditorProps> = {},
) =>
  renderToStaticMarkup(
    <StepEditor {...props(over)} initialProgress={at(step)} />,
  );

/** Un contrôleur réel de l'éditeur, pour rendre l'étape des textes sur n'importe quel élément. */
function Texts({
  who,
  prefs = DEFAULT_VIDEO_PREFS,
}: {
  who: TextTab;
  prefs?: VideoPrefs;
}) {
  const controller = useEditorController({
    prefs,
    patch: noop,
    sourceSize: null,
  });
  return (
    <TextsPane
      controller={controller}
      who={who}
      onWho={noop}
      attribution="QuranEnc.com — Hamidullah"
    />
  );
}

describe("le pas à pas dans le registre", () => {
  it("le mode « pas » a son éditeur (la table de montage n'est pas la sienne)", () => {
    expect(editorFor("pas")).toBe(StepEditor);
    expect(editorFor("pas")).not.toBe(editorFor("plateau"));
  });

  it("ExportEditor en mode « pas » monte le pas à pas, un seul bouton Exporter dans la barre", () => {
    const html = renderToStaticMarkup(<ExportEditor {...props()} mode="pas" />);
    expect(html).toContain('data-testid="editor-pas"');
    expect(html).not.toContain('data-testid="editor-plateau"');
    expect(html.match(/data-testid="video-export"/g)).toHaveLength(1);
    expect(html).toContain("Récitation du vendredi");
  });
});

describe("étape 1 : le cadre (ouverture par défaut)", () => {
  const html = renderToStaticMarkup(<StepEditor {...props()} />);

  it("trois pastilles, la première est l'étape en cours (aria-current)", () => {
    expect(html).toContain('aria-label="Les trois étapes"');
    expect(html.match(/data-testid="pas-step-\d"/g)).toHaveLength(3);
    expect(html).toMatch(
      /aria-current="step"[^>]*data-testid="pas-step-1"|data-testid="pas-step-1"[^>]*aria-current="step"/,
    );
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain("Étape 1 sur 3 : Le cadre");
    expect(html).toContain("Étape 3 sur 3 : Exporter");
  });

  it("l'encart « déjà prête » propose d'exporter tout de suite", () => {
    expect(html).toContain("Déjà prête avec nos réglages conseillés");
    expect(html).toContain('data-testid="pas-ready-export"');
    expect(html).toContain("Exporter maintenant");
  });

  it("le format et le fond sont là, la vidéo de fond aussi", () => {
    for (const f of ["16:9", "9:16", "1:1"])
      expect(html).toContain(`data-testid="video-orientation-${f}"`);
    expect(html).toContain('data-testid="video-bg-color"');
    expect(html).toContain('data-testid="slot-video-de-fond"');
  });

  it("une seule chose à faire : Suivant vers les textes, pas de Précédent, pas de gros Exporter", () => {
    expect(html).toContain('data-testid="pas-next"');
    expect(html).toContain("Suivant · Les textes");
    expect(html).not.toContain('data-testid="pas-prev"');
    expect(html).not.toContain('data-testid="pas-export"');
  });

  it("l'aperçu est verrouillé : pas de calque d'édition hors de l'étape des textes", () => {
    expect(html).not.toContain('data-testid="zone-arabic"');
  });

  it("aucun jargon en première ligne : pas de qualité ni de fluidité hors des réglages avancés", () => {
    expect(html).not.toMatch(/1080p|fps|bitrate|codec/i);
  });

  it("annonce les changements d'étape (région aria-live) et ceux du contrôleur", () => {
    expect(html).toContain('data-testid="pas-live"');
    expect(html).toContain('data-testid="editor-status"');
    expect(html.match(/aria-live="polite"/g)!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("l'encart « déjà prête »", () => {
  const card = (over: Partial<EditorProps>) =>
    renderToStaticMarkup(
      <ReadyCard editor={props(over)} onOpenPassages={noop} />,
    );

  it("sans passage à exporter il ne promet rien et propose d'en choisir", () => {
    const html = card({
      passages: { ...props().passages, count: 0 },
      exportAction: { ...props().exportAction, disabled: true },
    });
    expect(html).not.toContain("Déjà prête");
    expect(html).toContain("Il manque un passage");
    expect(html).toContain('data-testid="pas-ready-passages"');
    expect(html).not.toContain('data-testid="pas-ready-export"');
  });

  it("pendant l'export il dit où ça en est et le bouton ouvre le suivi", () => {
    const html = card({
      exportAction: {
        ...props().exportAction,
        status: "Vidéo 1 sur 2 · 40 %",
        label: "Voir les vidéos",
      },
    });
    expect(html).toContain("Vidéo 1 sur 2 · 40 %");
    expect(html).toContain("Voir les vidéos");
    expect(html).not.toContain("Déjà prête");
  });

  it("export impossible pour l'instant (chargement) : le bouton est grisé", () => {
    const html = card({
      exportAction: { ...props().exportAction, disabled: true },
    });
    expect(html).toMatch(
      /disabled=""[^>]*data-testid="pas-ready-export"|data-testid="pas-ready-export"[^>]*disabled=""/,
    );
  });
});

describe("étape 2 : les textes", () => {
  const html = render("textes");

  it("la pastille 2 est en cours, la 1 porte sa coche « faite »", () => {
    expect(html).toMatch(
      /aria-current="step"[^>]*data-testid="pas-step-2"|data-testid="pas-step-2"[^>]*aria-current="step"/,
    );
    expect(html).toContain("Étape 1 sur 3 : Le cadre (faite)");
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
  });

  it("un onglet par élément : arabe, traduction, onde, verset (cibles de bouton, pas de lien)", () => {
    for (const tab of ["arabic", "translation", "wave", "ref"])
      expect(html).toContain(`data-testid="pas-tab-${tab}"`);
    expect(html).toMatch(
      /aria-checked="true"[^>]*data-testid="pas-tab-arabic"/,
    );
  });

  it("l'aperçu se manipule à cette étape : le calque d'édition est monté", () => {
    expect(html).toContain('data-testid="zone-arabic"');
    expect(html).toContain('data-testid="zone-translation"');
  });

  it("on revient en arrière et on avance : Précédent et Suivant vers Exporter", () => {
    expect(html).toContain('data-testid="pas-prev"');
    expect(html).toContain("Précédent");
    expect(html).toContain("Suivant · Exporter");
  });

  it("l'étape du cadre reste montée mais cachée : l'envoi d'une vidéo de fond ne s'arrête pas", () => {
    expect(html).toMatch(
      /data-pane="cadre"[^>]*data-testid="pas-pane-cadre"[^>]*hidden=""/,
    );
    expect(html).toContain('data-testid="slot-video-de-fond"');
    // …et celle de l'étape 3 aussi, quand on y est.
    const last = render("exporter");
    expect(last).toMatch(/data-testid="pas-pane-cadre"[^>]*hidden=""/);
    expect(last).toContain('data-testid="slot-video-de-fond"');
  });

  it("l'arabe : cadenas et phrase, aucun champ de saisie du texte (I1)", () => {
    const arabic = renderToStaticMarkup(<Texts who="arabic" />);
    expect(arabic).toContain('data-testid="arabic-lock"');
    expect(arabic).toContain("jamais le modifier");
    expect(arabic).not.toContain("<textarea");
    expect(arabic).not.toMatch(/<input[^>]*type="text"/);
    // Taille − / +, fond du texte, flèches.
    expect(arabic).toContain('aria-label="Texte plus petit"');
    expect(arabic).toContain('aria-label="Texte plus grand"');
    expect(arabic).toContain('data-testid="panel-blur"');
    expect(arabic).toContain("Placer avec les flèches");
    expect(arabic).toContain("Plus de réglages");
    expect(arabic).not.toMatch(/petit<|moyen|grand</i);
  });

  it("la traduction garde son attribution collée à elle (I2)", () => {
    const translation = renderToStaticMarkup(<Texts who="translation" />);
    expect(translation).toContain('data-testid="translation-attribution"');
    expect(translation).toContain("QuranEnc.com — Hamidullah");
    expect(translation).toContain("restituée telle quelle");
    expect(translation).toContain("Afficher la traduction");
    expect(translation).not.toContain('data-testid="arabic-lock"');
  });

  it("la traduction masquée : l'interrupteur la remet, et plus aucun autre réglage ne traîne", () => {
    const hidden = renderToStaticMarkup(
      <Texts
        who="translation"
        prefs={{ ...DEFAULT_VIDEO_PREFS, showTranslation: false }}
      />,
    );
    expect(hidden).toContain('data-testid="pas-off-translation"');
    expect(hidden).toContain("Masqué");
    expect(hidden).not.toContain('aria-label="Texte plus grand"');
    expect(hidden).not.toContain('data-testid="panel-blur"');
    // L'onglet le dit aussi, pour un lecteur d'écran.
    expect(hidden).toContain("(masqué)");
    // L'arabe ne peut plus se masquer : une des deux écritures reste affichée.
    const arabic = renderToStaticMarkup(
      <Texts
        who="arabic"
        prefs={{ ...DEFAULT_VIDEO_PREFS, showTranslation: false }}
      />,
    );
    expect(arabic).toContain("Une des deux écritures reste affichée");
    expect(arabic).toMatch(
      /disabled=""[^>]*data-testid="pas-show-arabic"|data-testid="pas-show-arabic"[^>]*disabled=""/,
    );
  });

  it("l'onde : sa hauteur, ses flèches, pas de fond de texte ni de réglages de texte", () => {
    const wave = renderToStaticMarkup(<Texts who="wave" />);
    expect(wave).toContain("Hauteur de l’onde");
    expect(wave).toContain("Placer avec les flèches");
    expect(wave).not.toContain('data-testid="panel-blur"');
    expect(wave).not.toContain("Plus de réglages");
  });

  it("la sourate et le verset : taille et fond, comme un texte", () => {
    const ref = renderToStaticMarkup(<Texts who="ref" />);
    expect(ref).toContain('aria-label="Texte plus petit"');
    expect(ref).toContain("Afficher la sourate et le verset");
  });
});

describe("étape 3 : exporter", () => {
  const html = render("exporter");

  it("un résumé court, les passages en résumé, les réglages avancés rangés", () => {
    expect(html).toContain('data-testid="pas-summary"');
    expect(html).toContain("Horizontal");
    expect(html).toContain("Traduction");
    expect(html).toContain("Affichée");
    expect(html).toContain('data-testid="passages-summary"');
    expect(html).toContain("Tout l’audio · 20 s");
    expect(html).toContain('data-testid="passages-open"');
    expect(html).toMatch(/<details[^>]*data-testid="video-advanced"/);
    expect(html).toContain("Réglages avancés");
    expect(html).toContain('data-testid="slot-avance"');
  });

  it("un gros bouton Exporter remplace Suivant ; Précédent reste", () => {
    expect(html).toContain('data-testid="pas-export"');
    expect(html).not.toContain('data-testid="pas-next"');
    expect(html).toContain('data-testid="pas-prev"');
  });

  it("aucun calque d'édition : l'aperçu est verrouillé", () => {
    expect(html).not.toContain('data-testid="zone-arabic"');
  });

  it("le bouton prend l'étiquette de l'export en cours, et se grise quand l'export est impossible", () => {
    const many = render("exporter", {
      exportAction: { ...props().exportAction, label: "Exporter 3 vidéos" },
    });
    expect(many).toContain("Exporter 3 vidéos");
    const off = render("exporter", {
      exportAction: { ...props().exportAction, disabled: true },
    });
    expect(off).toMatch(
      /disabled=""[^>]*data-testid="pas-export"|data-testid="pas-export"[^>]*disabled=""/,
    );
  });

  it("la traduction masquée est dite dans le résumé", () => {
    const hidden = render("exporter", {
      prefs: { ...DEFAULT_VIDEO_PREFS, showTranslation: false },
    });
    expect(hidden).toContain("Masquée");
  });

  it("l'état de l'export est annoncé", () => {
    const busy = render("exporter", {
      exportAction: {
        ...props().exportAction,
        status: "Vidéo 1 sur 2 · 40 %",
        label: "En cours…",
        disabled: false,
      },
    });
    expect(busy).toContain('data-testid="pas-export-status"');
    expect(busy).toContain("Vidéo 1 sur 2 · 40 %");
  });

  it("le résumé seul, hors éditeur, nomme le fond choisi", () => {
    function Summary() {
      const controller = useEditorController({
        prefs: DEFAULT_VIDEO_PREFS,
        patch: noop,
        sourceSize: null,
      });
      return (
        <ExportPane
          editor={props({
            frame: { ...props().frame, selectedBg: "color" },
          })}
          controller={controller}
          onOpenPassages={noop}
        />
      );
    }
    expect(renderToStaticMarkup(<Summary />)).toContain("Couleur unie");
  });
});

describe("le cadre, seul", () => {
  it("le format avant le fond, le tout avec l'encart d'ouverture", () => {
    const html = renderToStaticMarkup(
      <FramePane editor={props()} onOpenPassages={noop} />,
    );
    expect(html.indexOf("pas-ready")).toBeLessThan(
      html.indexOf("video-orientation-16:9"),
    );
    expect(html.indexOf("video-orientation-16:9")).toBeLessThan(
      html.indexOf("video-bg-color"),
    );
  });
});

describe("la progression au départ", () => {
  it("sans mémoire (rendu serveur) on commence par le cadre", () => {
    const html = renderToStaticMarkup(
      <StepEditor {...props()} initialProgress={START_PROGRESS} />,
    );
    expect(html).toContain('data-step="cadre"');
  });
});
