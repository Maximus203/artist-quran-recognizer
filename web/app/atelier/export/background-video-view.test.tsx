import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CLIP_LIMITS } from "@/lib/background-video-policy";
import type { Flow } from "@/lib/background-video-flow";
import {
  BackgroundVideoView,
  type BackgroundVideoValue,
  type BackgroundVideoViewProps,
} from "./background-video-view";

/**
 * Rendu de tous les états de la section « vidéo de fond », sans navigateur : ce qui est écrit, les rôles et les
 * étiquettes d'accessibilité. Les gestes (glisser, clavier, toucher) sont éprouvés dans un vrai navigateur.
 */
const file = new File(["x"], "mer.mp4", { type: "video/mp4" });
const value = (
  over: Partial<BackgroundVideoValue> = {},
): BackgroundVideoValue => ({
  file,
  uploadId: "a".repeat(32),
  name: "mer calme.mp4",
  duration: 12,
  width: 1280,
  height: 720,
  offset: 0,
  mode: "loop",
  ...over,
});
const props = (
  over: Partial<BackgroundVideoViewProps> = {},
): BackgroundVideoViewProps => ({
  flow: { phase: "idle" },
  value: null,
  limits: DEFAULT_CLIP_LIMITS,
  recitationSeconds: 30,
  parts: 1,
  frames: [],
  announcement: "",
  onPick: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
  onRemove: vi.fn(),
  onMode: vi.fn(),
  onOffset: vi.fn(),
  ...over,
});
const html = (over: Partial<BackgroundVideoViewProps> = {}) =>
  renderToStaticMarkup(<BackgroundVideoView {...props(over)} />);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
const count = (markup: string, needle: string) =>
  markup.split(needle).length - 1;

describe("rien de choisi", () => {
  it("propose « Ma vidéo… », dit les formats, les plafonds et que la vidéo est muette", () => {
    const out = html();
    const t = text(out);
    expect(t).toContain("Ma vidéo…");
    expect(out).toContain('type="file"');
    expect(out).toMatch(/accept="[^"]*\.mp4/);
    expect(t).toContain("500 Mo");
    expect(t).toContain("10 min");
    expect(t).toMatch(/muette : seul le son de la récitation est exporté/);
    expect(out).not.toContain('role="progressbar"');
    expect(out).not.toContain('role="alert"');
  });
});

describe("lecture, envoi, préparation", () => {
  it("lecture : le dit, sans pourcentage inventé", () => {
    const flow: Flow = { phase: "reading", fileName: "mer.mp4", file };
    const out = html({ flow });
    expect(text(out)).toContain("Lecture de la vidéo…");
    expect(out).not.toContain("aria-valuenow");
    expect(text(out)).toContain("Annuler");
  });

  it("envoi : barre de progression avec sa valeur, le nom, et un bouton Annuler", () => {
    const flow: Flow = {
      phase: "sending",
      fileName: "mer.mp4",
      file,
      ratio: 0.426,
    };
    const out = html({ flow });
    expect(out).toContain('role="progressbar"');
    expect(out).toContain('aria-valuenow="43"');
    expect(out).toContain('aria-valuemin="0"');
    expect(out).toContain('aria-valuemax="100"');
    expect(text(out)).toContain("Envoi au serveur : 43 %");
    expect(text(out)).toContain("mer.mp4");
    expect(text(out)).toContain("Annuler");
    // on ne choisit pas un autre fichier par-dessus un envoi en cours
    expect(out).not.toContain('type="file"');
  });

  it("préparation : dit que c'est le serveur qui travaille", () => {
    const flow: Flow = {
      phase: "preparing",
      fileName: "mer.mp4",
      file,
      ratio: 0.8,
    };
    expect(text(html({ flow }))).toContain(
      "Préparation de la vidéo par le serveur : 80 %",
    );
  });
});

describe("erreurs expliquées", () => {
  const failed = (resumeId?: string): Flow => ({
    phase: "failed",
    fileName: "mer.mp4",
    file,
    error: {
      code: resumeId ? "network" : "unreadable",
      message: resumeId
        ? "La connexion a été coupée pendant l'envoi."
        : "Cette vidéo est illisible ou abîmée.",
      resumeId,
    },
  });

  it("annonce l'erreur (role alert) avec le message tel quel et propose un autre fichier", () => {
    const out = html({ flow: failed() });
    expect(out).toContain('role="alert"');
    expect(text(out)).toContain("Cette vidéo est illisible ou abîmée.");
    expect(text(out)).toContain("Choisir une autre vidéo");
    expect(text(out)).not.toContain("Reprendre l’envoi");
  });

  it("une coupure de réseau propose de reprendre, sans tout renvoyer", () => {
    const out = html({ flow: failed("abc") });
    expect(text(out)).toContain("Reprendre l’envoi");
    expect(text(out)).toContain("Abandonner");
  });
});

describe("vidéo prête : plus courte que la récitation", () => {
  const ready = (over: Partial<BackgroundVideoValue> = {}, more = {}) =>
    html({ flow: { phase: "ready" }, value: value(over), ...more });

  it("dit en clair ce qui se passe, et que la vidéo est muette", () => {
    const t = text(ready());
    expect(t).toContain("mer calme.mp4");
    expect(t).toContain(
      "Vidéo plus courte que la récitation : elle recommence toute seule, environ 2,5 fois.",
    );
    expect(t).toMatch(
      /La vidéo de fond est muette : seul le son de la récitation est exporté\./,
    );
    expect(t).toContain("12 s");
    expect(t).toContain("30 s");
  });

  it("propose les quatre comportements, boucle choisie par défaut, chacun avec son schéma", () => {
    const out = ready();
    expect(out).toContain('role="radiogroup"');
    expect(count(out, 'role="radio"')).toBe(4);
    for (const title of [
      "Recommencer",
      "Aller-retour",
      "S’arrêter sur la dernière image",
      "Ralentir pour tout couvrir",
    ])
      expect(text(out)).toContain(title);
    expect(count(out, 'aria-checked="true"')).toBe(1);
    expect(out).toMatch(
      /aria-checked="true"[^>]*data-mode="loop"|data-mode="loop"[^>]*aria-checked="true"/,
    );
    expect(count(out, 'class="bvs-diagram"')).toBe(4);
  });

  it("la bande « film » marque chaque raccord et les dit à un lecteur d'écran", () => {
    const out = ready();
    expect(count(out, 'class="bvs-seam"')).toBe(2);
    expect(text(out)).toContain("La vidéo recommence à 12 s, 24 s.");
    expect(out).toContain('role="img"');
  });

  it("aller-retour : tuiles retournées ; figé : « Image figée » ; ralenti : aucun raccord", () => {
    expect(ready({ mode: "pingpong" })).toContain('data-flip="true"');
    expect(text(ready({ mode: "freeze" }))).toContain("Image figée");
    const slow = ready({ mode: "slow" });
    expect(count(slow, 'class="bvs-seam"')).toBe(0);
    expect(text(slow)).toContain("ralentie pour tout couvrir");
  });

  it("n'affiche pas l'éditeur de portion", () => {
    expect(ready()).not.toContain('role="slider"');
  });

  it("les vignettes de la vidéo, quand elles sont prêtes, habillent la bande", () => {
    const out = ready(
      {},
      { frames: ["data:image/jpeg;a", null, "data:image/jpeg;c"] },
    );
    expect(out).toContain("--f0:url(");
    expect(out).toContain("--f2:url(");
    expect(out).not.toContain("--f1:");
  });
});

describe("vidéo prête : plus longue que la récitation", () => {
  const longer = (over: Partial<BackgroundVideoValue> = {}, more = {}) =>
    html({
      flow: { phase: "ready" },
      value: value({ duration: 60, offset: 5, ...over }),
      recitationSeconds: 20,
      ...more,
    });

  it("dit quelle portion est gardée, début et fin écrits", () => {
    const t = text(longer());
    expect(t).toContain("on garde la portion de 5 s à 25 s");
    expect(t).toContain("0:05,0");
    expect(t).toContain("0:25,0");
  });

  it("la fenêtre est un curseur accessible : bornes, valeur et texte lisible", () => {
    const out = longer();
    expect(out).toContain('role="slider"');
    expect(out).toContain('aria-valuemin="0"');
    expect(out).toContain('aria-valuemax="40"');
    expect(out).toContain('aria-valuenow="5"');
    expect(out).toContain(
      'aria-valuetext="Commence à 0:05,0 · finit à 0:25,0"',
    );
    expect(out).toContain('tabindex="0"');
  });

  it("boutons ± 0,1 s et ± 1 s, et « Début · Milieu · Fin », tous nommés", () => {
    const out = longer();
    for (const label of [
      "Reculer de 1 s",
      "Reculer de 0,1 s",
      "Avancer de 0,1 s",
      "Avancer de 1 s",
    ])
      expect(out).toContain(`aria-label="${label}"`);
    for (const chip of ["Début de la vidéo", "Milieu", "Fin de la vidéo"])
      expect(text(out)).toContain(chip);
  });

  it("le préréglage qui correspond au départ est marqué", () => {
    expect(longer({ offset: 0 })).toMatch(
      /aria-pressed="true"[^>]*>Début de la vidéo/,
    );
    expect(longer({ offset: 20 })).toMatch(/aria-pressed="true"[^>]*>Milieu/);
    expect(longer({ offset: 40 })).toMatch(
      /aria-pressed="true"[^>]*>Fin de la vidéo/,
    );
    expect(count(longer({ offset: 5 }), 'aria-pressed="true"')).toBe(0);
  });

  it("n'offre pas le choix du comportement : il ne concerne qu'une vidéo plus courte", () => {
    expect(longer()).not.toContain('role="radiogroup"');
  });

  it("plusieurs parties exportées : un seul départ pour toutes, dit en clair", () => {
    expect(text(longer({}, { parts: 3 }))).toMatch(
      /même départ vaut pour les 3 parties/,
    );
  });
});

describe("vidéo prête : autres cas", () => {
  const ready = (over: Partial<BackgroundVideoValue>, seconds = 30) =>
    html({
      flow: { phase: "ready" },
      value: value(over),
      recitationSeconds: seconds,
    });

  it("même durée : rien à régler, aucun réglage proposé", () => {
    const out = ready({ duration: 30 });
    expect(text(out)).toContain("rien à régler");
    expect(out).not.toContain('role="slider"');
    expect(out).not.toContain('role="radiogroup"');
  });

  it("durée inconnue : le dit et ne propose aucun réglage inventé", () => {
    const out = ready({ duration: 0 });
    expect(text(out)).toContain("Durée de la vidéo inconnue");
    expect(out).not.toContain('role="slider"');
    expect(out).not.toContain('role="radiogroup"');
  });

  it("propose de changer et de retirer la vidéo", () => {
    const t = text(ready({}));
    expect(t).toContain("Changer");
    expect(t).toContain("Retirer");
  });
});

describe("accessibilité et langage", () => {
  const states: Array<[string, Partial<BackgroundVideoViewProps>]> = [
    ["rien", {}],
    [
      "envoi",
      { flow: { phase: "sending", fileName: "a.mp4", file, ratio: 0.4 } },
    ],
    [
      "échec",
      {
        flow: {
          phase: "failed",
          fileName: "a.mp4",
          file,
          error: { code: "unreadable", message: "Cette vidéo est illisible." },
        },
      },
    ],
    ["courte", { flow: { phase: "ready" }, value: value() }],
    ["longue", { flow: { phase: "ready" }, value: value({ duration: 90 }) }],
  ];

  it("chaque bouton a un nom accessible", () => {
    for (const [label, over] of states) {
      const out = html(over);
      const buttons = out.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
      for (const button of buttons) {
        const named =
          /aria-label="[^"]+"/.test(button) || text(button).trim().length > 0;
        expect(named, `${label} : ${button.slice(0, 80)}`).toBe(true);
      }
    }
  });

  it("une région vivante polie annonce les changements", () => {
    const out = html({ announcement: "Vidéo prête." });
    expect(out).toMatch(/aria-live="polite"[^>]*>[^<]*Vidéo prête\./);
  });

  it("aucun jargon technique en première ligne", () => {
    for (const [, over] of states)
      expect(text(html(over))).not.toMatch(
        /ffmpeg|ffprobe|upload_id|H\.264|chunk|morceau|offset|vtime|sha/i,
      );
  });

  it("les éléments qui se manipulent portent des cibles de 44 px (classe de bouton à zone tactile)", () => {
    const out = html({
      flow: { phase: "ready" },
      value: value({ duration: 90 }),
    });
    expect(count(out, "bvs-btn")).toBeGreaterThanOrEqual(8);
  });
});
