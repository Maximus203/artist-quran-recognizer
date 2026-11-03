import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_VIDEO_PREFS } from "@/lib/export-video-prefs";
import type { ListeningPeaks } from "@/lib/listening";
import type { BackgroundVideoValue } from "../background-video-view";
import type { EditorProps, MontageData } from "./editor-types";
import { ExportEditor } from "./export-editor";
import { TableEditor } from "./table-editor";
import { TableHelp } from "./table-help";
import { RAIL } from "./table-panels";

/**
 * Ce que la table de montage rend, vérifié sur le HTML : les trois états, le rail, les pistes, la piste du fond
 * pour chaque situation de la vidéo (plus courte, plus longue, même durée), l'aide du premier affichage. Les gestes
 * (glisser la tête, le film, zoomer) sont testés sans DOM dans `lib/export-table-timeline.test.ts` et au vrai
 * navigateur (playbook `export-table-de-montage`). Aucun texte coranique n'apparaît dans la chronologie (I1).
 */

const noop = () => undefined;

const peaks: ListeningPeaks = {
  schema: "aqr.listening-peaks/1",
  sample_rate: 16000,
  per_second: 4,
  duration: 40,
  peaks: Array.from({ length: 160 }, (_, i) => ((i * 7) % 10) / 10),
};

const intervals = [
  {
    kind: "verse",
    ref: "112:1",
    t: [0, 8],
    text: "ARABE-DU-CORPUS-1",
    translation: "TRADUCTION-1",
    status: "recognized",
  },
  { kind: "formula", ref: null, t: [8, 10] },
  {
    kind: "verse",
    ref: "112:2",
    t: [10, 22],
    text: "ARABE-DU-CORPUS-2",
    translation: "TRADUCTION-2",
    status: "inferred",
  },
  {
    kind: "verse",
    ref: "112:3",
    t: [24, 40],
    text: "ARABE-DU-CORPUS-3",
    translation: "TRADUCTION-3",
    status: "recognized",
  },
] as never;

const clipOf = (
  duration: number,
  mode: "loop" | "pingpong" | "freeze" | "slow" = "loop",
  offset = 0,
): BackgroundVideoValue => ({
  file: new File(["x"], "dunes.mp4", { type: "video/mp4" }),
  uploadId: "up1",
  name: "dunes.mp4",
  duration,
  width: 1280,
  height: 720,
  offset,
  mode,
});

function montage(over: Partial<MontageData> = {}): MontageData {
  return {
    ranges: [{ id: 1, start: 0, end: 40 }],
    longest: 40,
    clip: null,
    onClip: vi.fn(),
    ...over,
  };
}

function props(over: Partial<EditorProps> = {}): EditorProps {
  return {
    sessionId: "s1",
    title: "Récitation du vendredi",
    subtitle: "3 passages · 40 s",
    prefs: DEFAULT_VIDEO_PREFS,
    patch: vi.fn(),
    preview: {
      intervals,
      peaks,
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
    },
    passages: {
      summary: "Tout l’audio · 40 s",
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
    montage: montage(),
    ...over,
  };
}

const render = (over: Partial<EditorProps> = {}) =>
  renderToStaticMarkup(<TableEditor {...props(over)} />);

describe("la table de montage : l'écran de départ", () => {
  it("le mode « table » monte la table de montage ; un seul bouton Exporter", () => {
    const html = renderToStaticMarkup(
      <ExportEditor {...props()} mode="table" />,
    );
    expect(html).toContain('data-testid="editor-table"');
    expect(html.match(/data-testid="video-export"/g)).toHaveLength(1);
    expect(html).toContain("Récitation du vendredi");
  });

  it("au départ : la chronologie entière, aucun panneau ouvert", () => {
    const html = render();
    expect(html).toContain('data-mode="idle"');
    expect(html).toContain('data-testid="table-timeline"');
    expect(html).not.toContain('data-testid="editor-sheet"');
  });

  it("le rail : Cadre · Arabe · Traduction · Onde · Verset · Fond · Passages, dans l'ordre", () => {
    expect(RAIL.map((tool) => tool.key)).toEqual([
      "cadre",
      "arabic",
      "translation",
      "wave",
      "ref",
      "fond",
      "passages",
    ]);
    const html = render();
    const order = RAIL.map((tool) =>
      html.indexOf(`data-testid="rail-${tool.key}"`),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const label of [
      "Cadre",
      "Arabe",
      "Traduction",
      "Onde",
      "Verset",
      "Fond",
      "Passages",
    ])
      expect(html).toContain(`<span>${label}</span>`);
  });

  it("le rail est une navigation nommée, aucun outil n'est enfoncé au départ", () => {
    const html = render();
    expect(html).toContain('aria-label="Outils de la table de montage"');
    expect(html).not.toContain('aria-pressed="true"');
  });

  it("les deux régions annoncées aux lecteurs d'écran existent", () => {
    const html = render();
    expect(html).toContain('data-testid="editor-status"');
    expect(html).toContain('data-testid="table-status"');
  });
});

describe("la chronologie", () => {
  it("quatre pistes : règle, passages, onde, fond ; la tête de lecture est un curseur nommé", () => {
    const html = render();
    expect(html).toContain('data-testid="tl-ruler"');
    expect(html).toContain('data-testid="tl-passages"');
    expect(html).toContain('data-testid="tl-wave"');
    expect(html).toContain('data-testid="tl-film"');
    expect(html).toMatch(
      /role="slider"[^>]*aria-label="Tête de lecture : l’instant montré dans l’aperçu"/,
    );
    expect(html).toMatch(/aria-valuemax="40"/);
  });

  it("un bloc par passage coranique, numéroté d'après le verset ; la formule n'en a pas", () => {
    const html = render();
    expect(html.match(/class="xt-blk"/g)).toHaveLength(3);
    expect(html).toContain("Passage 1, de 0,0 s à 8,0 s");
    expect(html).toContain("Passage 2, de 10,0 s à 22,0 s");
    expect(html).toContain("Passage 3, de 24,0 s à 40,0 s");
  });

  it("un passage hors des plages exportées le dit (à l'oreille comme à l'œil)", () => {
    const html = render({
      montage: montage({ ranges: [{ id: 1, start: 9, end: 23 }] }),
    });
    expect(html).toContain("Passage 1, de 0,0 s à 8,0 s, hors de la vidéo");
    expect(html).not.toContain(
      "Passage 2, de 10,0 s à 22,0 s, hors de la vidéo",
    );
  });

  it("jamais de texte coranique ni de traduction dans la chronologie (I1, I2)", () => {
    const html = render();
    expect(html).not.toContain("ARABE-DU-CORPUS");
    expect(html).not.toContain("TRADUCTION-");
    expect(html).not.toMatch(/[؀-ۿ]/);
  });

  it("les boutons de la tête de lecture : passage précédent, −1 s, −0,1, +0,1, +1 s, passage suivant", () => {
    const html = render();
    for (const id of ["prev", "back-1", "back-01", "fwd-01", "fwd-1", "next"])
      expect(html).toContain(`data-testid="tl-${id}"`);
    expect(html).toContain('aria-label="Reculer de 1 seconde"');
    expect(html).toContain('aria-label="Avancer de 0,1 seconde"');
  });

  it("l'aide est rouvrable à tout moment (le « ? » de la chronologie)", () => {
    expect(render()).toContain('aria-label="Comment lire la chronologie"');
  });

  it("une session sans onde n'a pas de chronologie, mais garde l'aperçu et le rail", () => {
    const html = render({
      preview: { ...props().preview, peaks: null },
    });
    expect(html).not.toContain('data-testid="table-timeline"');
    expect(html).toContain('data-testid="table-rail"');
  });

  it("sans données de montage (autre appelant), pas de chronologie", () => {
    const html = render({ montage: undefined });
    expect(html).not.toContain('data-testid="table-timeline"');
    expect(html).toContain('data-testid="table-rail"');
  });
});

describe("la piste « Fond »", () => {
  const withClip = (
    clip: BackgroundVideoValue,
    over: Partial<MontageData> = {},
  ) =>
    render({
      frame: { ...props().frame, selectedBg: "video" },
      montage: montage({ clip, ...over }),
    });

  it("une image : une piste fixe qui le dit", () => {
    const html = render();
    expect(html).toContain("Image fixe sur toute la durée.");
    expect(html).toContain('data-kind="still"');
  });

  it("la vidéo d'origine : elle défile avec la récitation", () => {
    const html = render({
      frame: { ...props().frame, selectedBg: "source", isVideo: true },
    });
    expect(html).toContain("La vidéo d’origine défile avec la récitation");
  });

  it("vidéo plus courte : un repère ⟲ par raccord, et la phrase qui dit combien de fois", () => {
    const html = withClip(clipOf(16));
    // 40 s / 16 s : raccords à 16 s et 32 s
    expect(html.match(/data-testid="bvs-seam"/g)).toHaveLength(2);
    expect(html).toContain("elle recommence toute seule, environ 2,5 fois");
    expect(html).toContain("en boucle ×2,5");
    expect(html).toMatch(
      /aria-label="La vidéo recommence à 16,0 s de la plage 1\. Changer ce que fait la vidéo\."/,
    );
    expect(html).toContain("pour changer.");
  });

  it("aller-retour : les raccords disent que la vidéo repart en arrière", () => {
    const html = withClip(clipOf(16, "pingpong"));
    expect(html).toContain("aller-retour ×2,5");
    expect(html).toContain("La vidéo repart en arrière à 16,0 s");
  });

  it("dernière image : un seul raccord, l'image figée", () => {
    const html = withClip(clipOf(16, "freeze"));
    expect(html.match(/data-testid="bvs-seam"/g)).toHaveLength(1);
    expect(html).toContain("Image figée");
    expect(html).toContain("puis image figée");
  });

  it("ralenti : aucun raccord", () => {
    const html = withClip(clipOf(16, "slow"));
    expect(html).not.toContain('data-testid="bvs-seam"');
    expect(html).toContain("ralentie à 40 %");
  });

  it("vidéo plus longue : une bande qu'on glisse, les valeurs de début et de fin, ± 0,1 s et ± 1 s", () => {
    const html = withClip(clipOf(65, "loop", 12), {
      longest: 22,
      ranges: [{ id: 1, start: 0, end: 22 }],
    });
    expect(html).toMatch(
      /role="slider"[^>]*aria-label="Partie de la vidéo de fond sous la plage 1 : fais-la glisser"/,
    );
    expect(html).toContain("Commence à 0:12,0 · finit à 0:34,0");
    expect(html).toContain("<b>0:12,0 → 0:34,0</b>");
    for (const label of [
      "Reculer de 1 s",
      "Reculer de 0,1 s",
      "Avancer de 0,1 s",
      "Avancer de 1 s",
    ])
      expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain('data-testid="bvs-seam"');
  });

  it("même durée : rien à régler, ni raccord ni bande à glisser", () => {
    const html = withClip(clipOf(40));
    expect(html).toContain("rien à régler");
    expect(html).not.toContain('data-testid="bvs-seam"');
    expect(html).not.toContain('data-testid="tl-film-slider"');
  });

  it("plusieurs plages : chaque plage a son segment, un seul départ vaut pour toutes", () => {
    const ranges = [
      { id: 1, start: 0, end: 22 },
      { id: 2, start: 24, end: 40 },
    ];
    const html = withClip(clipOf(65, "loop", 0), { ranges, longest: 22 });
    expect(html.match(/class="xt-seg"/g)).toHaveLength(2);
    expect(html).toContain("Le même départ vaut pour les 2 plages");
    expect(html).toContain("Partie de la vidéo de fond sous la plage 2");
  });

  it("une vidéo choisie mais un autre fond sélectionné : la piste montre ce fond, pas la vidéo", () => {
    const html = render({
      montage: montage({ clip: clipOf(16) }),
    });
    expect(html).not.toContain('data-testid="bvs-seam"');
  });
});

describe("l'aide du premier affichage", () => {
  it("explique en mots simples la chronologie, la piste et la tête de lecture, et se ferme", () => {
    const html = renderToStaticMarkup(<TableHelp onDismiss={noop} />);
    expect(html).toContain("<b>chronologie</b>");
    expect(html).toContain("<b>piste</b>");
    expect(html).toContain("<b>tête de lecture</b>");
    expect(html).toContain("Compris");
    expect(html).toContain('aria-label="Comment lire la chronologie"');
  });
});
