import { describe, expect, it } from "vitest";
import {
  filmView,
  formatClockTenths,
  keyboardOffset,
  MODE_CHOICES,
  nudgeOffset,
  offsetFromDrag,
  offsetFromTap,
  portionView,
  presetOffset,
  seamsText,
  statusText,
} from "./background-video-view";
import type { FitInput } from "./export-video-vtime";

/**
 * Le modèle de vue de la vidéo de fond : fonctions pures qui disent QUOI dessiner (bande « film », fenêtre de
 * portion, raccords) et quoi écrire. Les temps viennent de `export-video-vtime.ts` ; rien n'est recalculé ici.
 */
const fit = (over: Partial<FitInput> = {}): FitInput => ({
  videoDuration: 12,
  audioDuration: 30,
  offset: 0,
  mode: "loop",
  ...over,
});
const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe("bande « film » : vidéo plus courte que la récitation", () => {
  it("boucle : des tuiles côte à côte, la dernière coupée, un raccord entre deux", () => {
    const view = filmView(fit());
    expect(view.kind).toBe("loop");
    expect(view.tiles).toHaveLength(3);
    near(view.tiles[0].left, 0);
    near(view.tiles[0].width, 40);
    near(view.tiles[1].left, 40);
    near(view.tiles[2].left, 80);
    near(view.tiles[2].width, 20); // 6 s sur 12 : tuile coupée
    expect(view.tiles.every((t) => !t.flipped)).toBe(true);
    expect(view.seamTimes).toEqual([12, 24]);
    near(view.seams[0], 40);
    near(view.seams[1], 80);
    expect(view.frozen).toBeNull();
  });

  it("aller-retour : les tuiles paires sont retournées", () => {
    const view = filmView(fit({ mode: "pingpong" }));
    expect(view.tiles.map((t) => t.flipped)).toEqual([false, true, false]);
    expect(view.seamTimes).toEqual([12, 24]);
  });

  it("arrêt sur la dernière image : une tuile, puis une zone figée jusqu'à la fin", () => {
    const view = filmView(fit({ mode: "freeze" }));
    expect(view.tiles).toHaveLength(1);
    near(view.tiles[0].width, 40);
    expect(view.frozen).not.toBeNull();
    near(view.frozen?.left ?? 0, 40);
    near(view.frozen?.width ?? 0, 60);
    expect(view.seamTimes).toEqual([12]);
  });

  it("ralenti : une seule tuile étirée sur toute la récitation, aucun raccord", () => {
    const view = filmView(fit({ mode: "slow" }));
    expect(view.tiles).toEqual([{ left: 0, width: 100, flipped: false }]);
    expect(view.seams).toEqual([]);
    expect(view.frozen).toBeNull();
  });

  it("une vidéo minuscule sous une longue récitation : les tuiles deviennent un motif répété", () => {
    const view = filmView(fit({ videoDuration: 0.5, audioDuration: 3600 }));
    expect(view.dense).toBe(true);
    expect(view.tiles.length).toBeLessThanOrEqual(60);
    expect(view.tileWidth).toBeCloseTo((0.5 / 3600) * 100, 8);
    expect(view.seams.length).toBeLessThanOrEqual(60);
  });
});

describe("bande « film » : autres situations", () => {
  it("même durée : une tuile, rien à régler", () => {
    const view = filmView(fit({ videoDuration: 30 }));
    expect(view.kind).toBe("same");
    expect(view.tiles).toEqual([{ left: 0, width: 100, flipped: false }]);
    expect(view.seams).toEqual([]);
  });

  it("plus longue : c'est la fenêtre de portion qui parle, pas des tuiles de boucle", () => {
    const view = filmView(fit({ videoDuration: 90 }));
    expect(view.kind).toBe("portion");
    expect(view.tiles).toEqual([]);
    expect(view.seams).toEqual([]);
  });

  it("durée inconnue ou nulle : une tuile, aucun raccord inventé", () => {
    for (const videoDuration of [0, Number.NaN, -1]) {
      const view = filmView(fit({ videoDuration }));
      expect(view.kind).toBe("unknown");
      expect(view.seams).toEqual([]);
    }
  });
});

describe("raccords dits à voix haute (lecteur d'écran)", () => {
  it("liste les premiers instants, puis s'arrête", () => {
    expect(seamsText([12, 24])).toBe("La vidéo recommence à 12 s, 24 s.");
    expect(seamsText([4, 8, 12, 16, 20, 24, 28, 32])).toBe(
      "La vidéo recommence à 4 s, 8 s, 12 s, 16 s, 20 s, 24 s, et ainsi de suite.",
    );
    expect(seamsText([])).toBe("");
  });
});

describe("fenêtre de portion : vidéo plus longue", () => {
  it("place la fenêtre éclairée, en pourcentage de la vidéo", () => {
    const view = portionView(
      fit({ videoDuration: 60, audioDuration: 20, offset: 5 }),
    );
    near(view.leftPct, (5 / 60) * 100);
    near(view.widthPct, (20 / 60) * 100);
    expect([view.from, view.to, view.max]).toEqual([5, 25, 40]);
    expect(view.valueText).toBe("Commence à 0:05,0 · finit à 0:25,0");
  });

  it("un départ trop grand est ramené dans la vidéo", () => {
    const view = portionView(
      fit({ videoDuration: 60, audioDuration: 20, offset: 999 }),
    );
    expect(view.from).toBe(40);
    expect(view.to).toBe(60);
    near(view.leftPct + view.widthPct, 100);
  });

  it("une fenêtre étroite (récitation courte, vidéo longue) est signalée pour que les repères se décalent", () => {
    expect(
      portionView(fit({ videoDuration: 600, audioDuration: 20 })).narrow,
    ).toBe(true);
    expect(
      portionView(fit({ videoDuration: 60, audioDuration: 30 })).narrow,
    ).toBe(false);
  });

  it("une vidéo pas plus longue : aucune marge à choisir", () => {
    const view = portionView(fit({ videoDuration: 10, audioDuration: 20 }));
    expect(view.max).toBe(0);
  });
});

describe("déplacer la portion : boutons, préréglages, clavier, glisser", () => {
  const ctx = { videoDuration: 60, audioDuration: 20 };

  it("± 0,1 s et ± 1 s, arrondi au dixième, borné", () => {
    expect(nudgeOffset(5, 0.1, ctx)).toBe(5.1);
    expect(nudgeOffset(5, -1, ctx)).toBe(4);
    expect(nudgeOffset(0.05, -0.1, ctx)).toBe(0);
    expect(nudgeOffset(39.95, 0.1, ctx)).toBe(40);
    expect(nudgeOffset(0.1, 0.2, ctx)).toBe(0.3); // pas de 0,30000000000000004
  });

  it("début · milieu · fin", () => {
    expect(presetOffset("start", ctx)).toBe(0);
    expect(presetOffset("middle", ctx)).toBe(20);
    expect(presetOffset("end", ctx)).toBe(40);
    expect(
      presetOffset("middle", { videoDuration: 61.3, audioDuration: 20 }),
    ).toBe(20.6);
  });

  it("clavier : flèches 0,1 s, Maj + flèches 1 s, Page ± 5 s, Début, Fin ; le reste est ignoré", () => {
    const k = (key: string, shift = false, offset = 10) =>
      keyboardOffset(key, shift, offset, ctx);
    expect(k("ArrowRight")).toBe(10.1);
    expect(k("ArrowLeft")).toBe(9.9);
    expect(k("ArrowRight", true)).toBe(11);
    expect(k("ArrowLeft", true)).toBe(9);
    expect(k("ArrowUp")).toBe(10.1);
    expect(k("ArrowDown")).toBe(9.9);
    expect(k("PageUp")).toBe(5);
    expect(k("PageDown")).toBe(15);
    expect(k("Home")).toBe(0);
    expect(k("End")).toBe(40);
    expect(k("a")).toBeNull();
    expect(k("Enter")).toBeNull();
  });

  it("glisser le film : un déplacement en pixels devient un déplacement en secondes", () => {
    // piste de 300 px pour 60 s : 1 px = 0,2 s
    expect(offsetFromDrag(10, 50, 300, ctx)).toBe(20);
    expect(offsetFromDrag(10, -100, 300, ctx)).toBe(0);
    expect(offsetFromDrag(30, 999, 300, ctx)).toBe(40);
    expect(offsetFromDrag(10, 50, 0, ctx)).toBe(10); // piste sans largeur : rien ne bouge
  });

  it("toucher la piste : la fenêtre se centre sur le point touché", () => {
    // toucher à 50 % de 60 s = 30 s ; fenêtre de 20 s centrée : démarre à 20 s
    expect(offsetFromTap(150, 300, ctx)).toBe(20);
    expect(offsetFromTap(0, 300, ctx)).toBe(0);
    expect(offsetFromTap(300, 300, ctx)).toBe(40);
  });
});

describe("les phrases", () => {
  it("dit la situation en clair, avec les durées", () => {
    expect(statusText(fit())).toBe(
      "Vidéo plus courte que la récitation : elle recommence toute seule, environ 2,5 fois.",
    );
    expect(statusText(fit({ videoDuration: 90, offset: 3 }))).toContain(
      "on garde la portion de 3 s à 33 s",
    );
    expect(statusText(fit({ videoDuration: 30 }))).toContain("rien à régler");
  });

  it("plusieurs parties exportées : dit qu'un seul départ vaut pour toutes", () => {
    const text = statusText(fit({ videoDuration: 90 }), 3);
    expect(text).toContain("3 parties");
    expect(text).toMatch(/même départ/i);
    expect(statusText(fit({ videoDuration: 90 }), 1)).not.toMatch(/parties/);
  });

  it("l'horloge : minutes, secondes et dixième, à la française", () => {
    expect(formatClockTenths(0)).toBe("0:00,0");
    expect(formatClockTenths(5.04)).toBe("0:05,0");
    expect(formatClockTenths(65.26)).toBe("1:05,3");
    expect(formatClockTenths(Number.NaN)).toBe("0:00,0");
    expect(formatClockTenths(-4)).toBe("0:00,0");
  });

  it("les quatre comportements ont un titre et une phrase, boucle d'abord", () => {
    expect(MODE_CHOICES.map((m) => m.mode)).toEqual([
      "loop",
      "pingpong",
      "freeze",
      "slow",
    ]);
    for (const choice of MODE_CHOICES) {
      expect(choice.title.length).toBeGreaterThan(5);
      expect(choice.hint.length).toBeGreaterThan(15);
    }
    expect(MODE_CHOICES[2].title).toBe("S’arrêter sur la dernière image");
    expect(MODE_CHOICES[3].title).toBe("Ralentir pour tout couvrir");
  });
});
