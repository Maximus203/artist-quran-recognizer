import { describe, expect, it } from "vitest";
import {
  NUDGE_STEP,
  NUDGE_STEP_BIG,
  SNAP_MARGIN,
  activeLayoutKey,
  blocksAt,
  boxFields,
  boxToPx,
  centerBox,
  clampBox,
  cycleBlock,
  defaultBox,
  deltaToFraction,
  moveBox,
  nudgeBox,
  pinchSize,
  pointToFraction,
  pxToBox,
  overlappingBlocks,
  repeatDelay,
  resizeBox,
  setBoxField,
  sizePercent,
  snapThreshold,
  stepSize,
  touchDistance,
} from "./export-video-edit";
import { DEFAULT_LAYOUTS, MIN_BOX, SIZE_LIMITS } from "./export-video-model";

const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };
const NO_SNAP = { snap: 0 };
const inFrame = (b: { x: number; y: number; w: number; h: number }) => {
  expect(b.x).toBeGreaterThanOrEqual(0);
  expect(b.y).toBeGreaterThanOrEqual(0);
  expect(b.x + b.w).toBeLessThanOrEqual(1 + 1e-9);
  expect(b.y + b.h).toBeLessThanOrEqual(1 + 1e-9);
};

describe("clampBox", () => {
  it("garde une boîte valide telle quelle", () => {
    expect(clampBox(box)).toEqual(box);
  });

  it("ramène une boîte hors cadre dans le cadre sans la déformer", () => {
    expect(clampBox({ x: 0.9, y: -0.4, w: 0.4, h: 0.2 })).toEqual({
      x: 0.6,
      y: 0,
      w: 0.4,
      h: 0.2,
    });
  });

  it("impose la taille minimale et la taille du cadre au plus", () => {
    const tiny = clampBox({ x: 0.5, y: 0.5, w: 0, h: -2 });
    expect(tiny.w).toBe(MIN_BOX.w);
    expect(tiny.h).toBe(MIN_BOX.h);
    const huge = clampBox({ x: 0.3, y: 0.3, w: 4, h: 9 });
    expect(huge).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("valeurs absurdes (NaN, infini) : boîte valide", () => {
    inFrame(
      clampBox({ x: Number.NaN, y: Infinity, w: Number.NaN, h: -Infinity }),
    );
  });
});

describe("moveBox", () => {
  it("déplace librement, sans changer la taille", () => {
    const r = moveBox(box, { dx: 0.1, dy: -0.05 }, NO_SNAP);
    expect(r.box.x).toBeCloseTo(0.3, 9);
    expect(r.box.y).toBeCloseTo(0.25, 9);
    expect(r.box.w).toBe(box.w);
    expect(r.box.h).toBe(box.h);
    expect(r.guides).toEqual([]);
  });

  it("garde la boîte dans le cadre (hors cadre impossible)", () => {
    const far = moveBox(box, { dx: 5, dy: 5 }, NO_SNAP).box;
    expect(far.x).toBeCloseTo(0.6, 9);
    expect(far.y).toBeCloseTo(0.8, 9);
    const back = moveBox(box, { dx: -5, dy: -5 }, NO_SNAP).box;
    expect(back.x).toBe(0);
    expect(back.y).toBe(0);
  });

  it("s'aimante sur le centre et donne le repère", () => {
    // centre de la boîte = 0,4 ; on la tire vers 0,495
    const r = moveBox(box, { dx: 0.095, dy: 0 }, { snap: 0.02 });
    expect(r.box.x + r.box.w / 2).toBeCloseTo(0.5, 9);
    expect(r.guides).toContainEqual({ axis: "x", at: 0.5, kind: "center" });
  });

  it("s'aimante sur le centre vertical", () => {
    const r = moveBox(box, { dx: 0, dy: 0.095 }, { snap: 0.02 });
    expect(r.box.y + r.box.h / 2).toBeCloseTo(0.5, 9);
    expect(r.guides).toContainEqual({ axis: "y", at: 0.5, kind: "center" });
  });

  it("s'aimante sur les marges gauche et droite", () => {
    const left = moveBox(box, { dx: -0.14, dy: 0 }, { snap: 0.02 });
    expect(left.box.x).toBeCloseTo(SNAP_MARGIN, 9);
    expect(left.guides).toContainEqual({
      axis: "x",
      at: SNAP_MARGIN,
      kind: "margin",
    });
    const right = moveBox(box, { dx: 0.36, dy: 0 }, { snap: 0.02 });
    expect(right.box.x + right.box.w).toBeCloseTo(1 - SNAP_MARGIN, 9);
    expect(right.guides).toContainEqual({
      axis: "x",
      at: 1 - SNAP_MARGIN,
      kind: "margin",
    });
  });

  it("s'aimante sur les marges haute et basse", () => {
    const top = moveBox(box, { dx: 0, dy: -0.24 }, { snap: 0.02 });
    expect(top.box.y).toBeCloseTo(SNAP_MARGIN, 9);
    const bottom = moveBox(box, { dx: 0, dy: 0.46 }, { snap: 0.02 });
    expect(bottom.box.y + bottom.box.h).toBeCloseTo(1 - SNAP_MARGIN, 9);
  });

  it("ne s'aimante pas au-delà du seuil", () => {
    const r = moveBox(box, { dx: 0.05, dy: 0 }, { snap: 0.02 });
    expect(r.box.x).toBeCloseTo(0.25, 9);
    expect(r.guides).toEqual([]);
  });

  it("le seuil 0 coupe l'aimant (Alt ou option)", () => {
    const r = moveBox(box, { dx: 0.0995, dy: 0 }, NO_SNAP);
    expect(r.box.x + r.box.w / 2).toBeCloseTo(0.4995, 9);
  });

  it("choisit le repère le plus proche quand deux sont à portée", () => {
    const wide = { x: 0.05, y: 0.3, w: 0.9, h: 0.2 }; // centre 0,5 et marges déjà tenues
    const r = moveBox(wide, { dx: 0.004, dy: 0 }, { snap: 0.02 });
    expect(r.box.x).toBeCloseTo(0.05, 9);
  });

  it("l'aimant ne sort jamais la boîte du cadre", () => {
    const r = moveBox(
      { x: 0.55, y: 0.3, w: 0.4, h: 0.2 },
      { dx: 9, dy: 0 },
      {
        snap: 0.05,
      },
    );
    inFrame(r.box);
  });

  it("le seuil se calcule depuis des pixels d'écran", () => {
    expect(snapThreshold(10, 500)).toBeCloseTo(0.02, 9);
    expect(snapThreshold(10, 0)).toBe(0);
  });
});

describe("resizeBox", () => {
  it("poignée est : change la largeur seulement", () => {
    const r = resizeBox(box, "e", { dx: 0.1, dy: 0.3 }, NO_SNAP).box;
    expect(r).toEqual({ x: 0.2, y: 0.3, w: expect.closeTo(0.5, 9), h: 0.2 });
  });

  it("poignée nord-ouest : déplace le coin, l'angle opposé reste en place", () => {
    const r = resizeBox(box, "nw", { dx: -0.1, dy: -0.1 }, NO_SNAP).box;
    expect(r.x).toBeCloseTo(0.1, 9);
    expect(r.y).toBeCloseTo(0.2, 9);
    expect(r.x + r.w).toBeCloseTo(0.6, 9);
    expect(r.y + r.h).toBeCloseTo(0.5, 9);
  });

  it("poignées sud et ouest", () => {
    const s = resizeBox(box, "s", { dx: 0, dy: 0.1 }, NO_SNAP).box;
    expect(s.h).toBeCloseTo(0.3, 9);
    const w = resizeBox(box, "w", { dx: 0.1, dy: 0 }, NO_SNAP).box;
    expect(w.x).toBeCloseTo(0.3, 9);
    expect(w.w).toBeCloseTo(0.3, 9);
  });

  it("ne descend jamais sous la taille minimale et ne se retourne pas", () => {
    const r = resizeBox(box, "e", { dx: -5, dy: 0 }, NO_SNAP).box;
    expect(r.w).toBe(MIN_BOX.w);
    expect(r.x).toBe(0.2);
    const l = resizeBox(box, "w", { dx: 5, dy: 0 }, NO_SNAP).box;
    expect(l.w).toBe(MIN_BOX.w);
    expect(l.x + l.w).toBeCloseTo(0.6, 9);
    const t = resizeBox(box, "n", { dx: 0, dy: 5 }, NO_SNAP).box;
    expect(t.h).toBe(MIN_BOX.h);
  });

  it("reste dans le cadre", () => {
    inFrame(resizeBox(box, "se", { dx: 9, dy: 9 }, NO_SNAP).box);
    inFrame(resizeBox(box, "nw", { dx: -9, dy: -9 }, NO_SNAP).box);
    expect(resizeBox(box, "se", { dx: 9, dy: 9 }, NO_SNAP).box).toEqual({
      x: 0.2,
      y: 0.3,
      w: expect.closeTo(0.8, 9),
      h: expect.closeTo(0.7, 9),
    });
  });

  it("aimante le bord déplacé sur les marges et le centre, avec repère", () => {
    const m = resizeBox(box, "e", { dx: 0.345, dy: 0 }, { snap: 0.02 });
    expect(m.box.x + m.box.w).toBeCloseTo(1 - SNAP_MARGIN, 9);
    expect(m.guides).toContainEqual({
      axis: "x",
      at: 1 - SNAP_MARGIN,
      kind: "margin",
    });
    const c = resizeBox(box, "e", { dx: -0.095, dy: 0 }, { snap: 0.02 });
    expect(c.box.x + c.box.w).toBeCloseTo(0.5, 9);
    expect(c.guides).toContainEqual({ axis: "x", at: 0.5, kind: "center" });
  });

  it("n'aimante pas l'arête qui ne bouge pas", () => {
    const r = resizeBox(box, "e", { dx: 0, dy: 0 }, { snap: 0.5 });
    expect(r.box.x).toBe(0.2);
  });
});

describe("nudgeBox (clavier)", () => {
  it("les flèches déplacent de 1 %, avec Maj de 5 %", () => {
    expect(NUDGE_STEP).toBe(0.01);
    expect(NUDGE_STEP_BIG).toBe(0.05);
    expect(nudgeBox(box, "ArrowRight", {})!.x).toBeCloseTo(0.21, 9);
    expect(nudgeBox(box, "ArrowLeft", { shift: true })!.x).toBeCloseTo(0.15, 9);
    expect(nudgeBox(box, "ArrowDown", {})!.y).toBeCloseTo(0.31, 9);
    expect(nudgeBox(box, "ArrowUp", { shift: true })!.y).toBeCloseTo(0.25, 9);
  });

  it("Ctrl + flèches change la zone (largeur, hauteur)", () => {
    const wider = nudgeBox(box, "ArrowRight", { ctrl: true })!;
    expect(wider.w).toBeCloseTo(0.41, 9);
    expect(wider.x).toBe(0.2);
    const shorter = nudgeBox(box, "ArrowUp", { ctrl: true, shift: true })!;
    expect(shorter.h).toBeCloseTo(0.15, 9);
    expect(nudgeBox(box, "ArrowLeft", { ctrl: true })!.w).toBeCloseTo(0.39, 9);
    expect(nudgeBox(box, "ArrowDown", { ctrl: true })!.h).toBeCloseTo(0.21, 9);
  });

  it("reste dans le cadre et au-dessus de la taille minimale", () => {
    const atEdge = { x: 0.6, y: 0.8, w: 0.4, h: 0.2 };
    expect(nudgeBox(atEdge, "ArrowRight", { shift: true })).toEqual(atEdge);
    expect(nudgeBox(atEdge, "ArrowDown", {})).toEqual(atEdge);
    expect(nudgeBox(atEdge, "ArrowRight", { ctrl: true })).toEqual(atEdge);
    const small = { x: 0.2, y: 0.3, w: MIN_BOX.w, h: MIN_BOX.h };
    expect(nudgeBox(small, "ArrowLeft", { ctrl: true })).toEqual(small);
  });

  it("une autre touche n'est pas gérée", () => {
    expect(nudgeBox(box, "a", {})).toBeNull();
    expect(nudgeBox(box, "Enter", { ctrl: true })).toBeNull();
  });
});

describe("pixels d'écran ↔ fractions", () => {
  const frame = { left: 40, top: 100, width: 400, height: 225 };

  it("convertit un point de l'écran en fractions du cadre", () => {
    expect(pointToFraction({ x: 240, y: 212.5 }, frame)).toEqual({
      x: 0.5,
      y: 0.5,
    });
    expect(pointToFraction({ x: 0, y: 0 }, frame)).toEqual({ x: 0, y: 0 });
    expect(pointToFraction({ x: 900, y: 900 }, frame)).toEqual({ x: 1, y: 1 });
  });

  it("convertit un déplacement en pixels en fractions", () => {
    expect(deltaToFraction({ dx: 40, dy: 22.5 }, frame)).toEqual({
      dx: 0.1,
      dy: 0.1,
    });
  });

  it("aller-retour boîte ↔ pixels", () => {
    const px = boxToPx(box, { width: 1920, height: 1080 });
    expect(px).toEqual({ x: 384, y: 324, width: 768, height: 216 });
    const back = pxToBox(px, { width: 1920, height: 1080 });
    expect(back.x).toBeCloseTo(box.x, 9);
    expect(back.h).toBeCloseTo(box.h, 9);
  });

  it("cadre de taille nulle : pas de division par zéro", () => {
    const empty = { left: 0, top: 0, width: 0, height: 0 };
    expect(pointToFraction({ x: 5, y: 5 }, empty)).toEqual({ x: 0, y: 0 });
    expect(deltaToFraction({ dx: 5, dy: 5 }, empty)).toEqual({ dx: 0, dy: 0 });
    expect(
      pxToBox({ x: 1, y: 1, width: 1, height: 1 }, { width: 0, height: 0 }),
    ).toEqual(clampBox({ x: 0, y: 0, w: 0, h: 0 }));
  });
});

describe("taille du texte par pas (− / +)", () => {
  it("un pas change d'environ 6 %", () => {
    expect(stepSize(1, 1)).toBeCloseTo(1.06, 2);
    expect(stepSize(1, -1)).toBeCloseTo(0.94, 2);
    expect(stepSize(2, 1)).toBeCloseTo(2.12, 2);
  });

  it("monte et redescend au même point", () => {
    let size = 1;
    for (let i = 0; i < 6; i++) size = stepSize(size, 1);
    for (let i = 0; i < 6; i++) size = stepSize(size, -1);
    expect(size).toBeCloseTo(1, 2);
  });

  it("change toujours d'au moins un cran visible, et se borne", () => {
    expect(stepSize(0.5, 1)).toBeGreaterThan(0.5);
    expect(stepSize(SIZE_LIMITS.max, 1)).toBe(SIZE_LIMITS.max);
    expect(stepSize(SIZE_LIMITS.min, -1)).toBe(SIZE_LIMITS.min);
    expect(stepSize(SIZE_LIMITS.max - 0.01, 1)).toBe(SIZE_LIMITS.max);
  });

  it("taille invalide : repart de 1", () => {
    expect(stepSize(Number.NaN, 1)).toBeCloseTo(1.06, 2);
    expect(stepSize(-3, -1)).toBeCloseTo(0.94, 2);
  });

  it("affiche un pourcentage entier", () => {
    expect(sizePercent(1)).toBe(100);
    expect(sizePercent(1.06)).toBe(106);
    expect(sizePercent(0.4)).toBe(40);
  });
});

describe("pincement à deux doigts", () => {
  it("la taille suit l'écart des doigts", () => {
    expect(pinchSize(1, 100, 150)).toBeCloseTo(1.5, 9);
    expect(pinchSize(2, 200, 100)).toBeCloseTo(1, 9);
    expect(pinchSize(1, 100, 100)).toBe(1);
  });

  it("se borne", () => {
    expect(pinchSize(1, 10, 1000)).toBe(SIZE_LIMITS.max);
    expect(pinchSize(1, 1000, 1)).toBe(SIZE_LIMITS.min);
  });

  it("écart de départ nul ou invalide : taille inchangée", () => {
    expect(pinchSize(1.3, 0, 50)).toBe(1.3);
    expect(pinchSize(1.3, Number.NaN, 50)).toBe(1.3);
    expect(pinchSize(1.3, 50, Number.NaN)).toBe(1.3);
  });

  it("mesure l'écart entre deux doigts", () => {
    expect(touchDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("blocksAt (choisir un élément en le touchant)", () => {
  const layout = DEFAULT_LAYOUTS["16:9"];

  it("renvoie les blocs sous le doigt, le plus petit d'abord", () => {
    const stacked = {
      ...layout,
      ref: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 },
      arabic: { x: 0.1, y: 0.18, w: 0.8, h: 0.3 },
    };
    expect(blocksAt(stacked, { x: 0.2, y: 0.25 })).toEqual(["ref", "arabic"]);
  });

  it("rien sous le doigt : liste vide", () => {
    expect(blocksAt(layout, { x: 0.01, y: 0.01 })).toEqual([]);
  });

  it("l'onde se touche aussi", () => {
    expect(blocksAt(layout, { x: 0.5, y: 0.9 })).toEqual(["wave"]);
  });
});

describe("blocksAt avec des éléments masqués", () => {
  const layout = DEFAULT_LAYOUTS["16:9"];

  it("ne renvoie pas un bloc masqué : il n'est plus dans l'aperçu", () => {
    expect(blocksAt(layout, { x: 0.5, y: 0.9 }, { wave: false })).toEqual([]);
    expect(blocksAt(layout, { x: 0.5, y: 0.3 }, { wave: false })).toEqual([
      "arabic",
    ]);
  });

  it("un bloc absent de la liste compte comme visible", () => {
    expect(blocksAt(layout, { x: 0.5, y: 0.9 }, {})).toEqual(["wave"]);
  });
});

describe("overlappingBlocks (pastilles quand les éléments se chevauchent)", () => {
  const layout = DEFAULT_LAYOUTS["16:9"];

  it("la mise en page par défaut ne se chevauche pas : les boîtes se touchent seulement", () => {
    expect(overlappingBlocks(layout)).toEqual([]);
    expect(overlappingBlocks(DEFAULT_LAYOUTS["9:16"])).toEqual([]);
    expect(overlappingBlocks(DEFAULT_LAYOUTS["1:1"])).toEqual([]);
  });

  it("nomme les deux blocs qui se recouvrent, dans l'ordre des blocs", () => {
    const stacked = {
      ...layout,
      translation: { x: 0.08, y: 0.5, w: 0.84, h: 0.2 },
    };
    expect(overlappingBlocks(stacked)).toEqual(["arabic", "translation"]);
  });

  it("un bloc masqué ne chevauche personne", () => {
    const stacked = {
      ...layout,
      translation: { x: 0.08, y: 0.5, w: 0.84, h: 0.2 },
    };
    expect(overlappingBlocks(stacked, { translation: false })).toEqual([]);
  });
});

describe("cycleBlock (toucher encore au même endroit)", () => {
  it("sans sélection, prend le premier (le plus petit)", () => {
    expect(cycleBlock(["ref", "arabic"], null)).toBe("ref");
  });

  it("déjà choisi : passe au suivant, puis revient au début", () => {
    expect(cycleBlock(["ref", "arabic"], "ref")).toBe("arabic");
    expect(cycleBlock(["ref", "arabic"], "arabic")).toBe("ref");
  });

  it("l'élément choisi n'est pas sous le doigt : prend le premier", () => {
    expect(cycleBlock(["ref", "arabic"], "wave")).toBe("ref");
  });

  it("rien sous le doigt : null", () => {
    expect(cycleBlock([], "ref")).toBeNull();
  });
});

describe("boxFields et setBoxField (Gauche, Haut, Largeur, Hauteur)", () => {
  it("lit la boîte en pourcents, à 0,1 % près", () => {
    expect(boxFields({ x: 0.2, y: 0.3, w: 0.4, h: 0.2 })).toEqual({
      left: 20,
      top: 30,
      width: 40,
      height: 20,
    });
    expect(boxFields({ x: 0.1234, y: 0, w: 0.5, h: 0.0449 }).left).toBe(12.3);
  });

  it("Gauche et Haut déplacent sans changer la taille, bornés au cadre", () => {
    const moved = setBoxField(box, "left", 70);
    expect(moved).toEqual({ ...box, x: 0.6 });
    expect(setBoxField(box, "top", -5).y).toBe(0);
    expect(setBoxField(box, "top", 95).y).toBeCloseTo(0.8, 6);
  });

  it("Largeur et Hauteur changent la zone, le coin haut-gauche reste", () => {
    const wider = setBoxField(box, "width", 50);
    expect(wider).toEqual({ ...box, w: 0.5 });
    expect(setBoxField(box, "height", 90).h).toBeCloseTo(0.7, 6);
  });

  it("jamais plus petit que le minimum ni hors du cadre", () => {
    expect(setBoxField(box, "width", 0).w).toBe(MIN_BOX.w);
    expect(setBoxField(box, "height", 0).h).toBe(MIN_BOX.h);
    expect(setBoxField(box, "width", 400).w).toBeCloseTo(0.8, 6);
    inFrame(setBoxField(box, "width", 400));
  });

  it("une saisie invalide laisse la boîte telle quelle", () => {
    expect(setBoxField(box, "left", Number.NaN)).toEqual(box);
    expect(setBoxField(box, "width", Infinity)).toEqual(box);
  });
});

describe("centerBox", () => {
  it("centre à l'horizontale, à la verticale ou les deux, taille inchangée", () => {
    expect(centerBox(box, "x")).toEqual({ ...box, x: 0.3 });
    expect(centerBox(box, "y")).toEqual({ ...box, y: 0.4 });
    expect(centerBox(box, "both")).toEqual({ ...box, x: 0.3, y: 0.4 });
  });
});

describe("defaultBox (remettre à la place d'origine)", () => {
  it("rend une COPIE de la boîte par défaut du format", () => {
    const original = defaultBox("9:16", "wave");
    expect(original).toEqual(DEFAULT_LAYOUTS["9:16"].wave);
    original.x = 0.9;
    expect(DEFAULT_LAYOUTS["9:16"].wave.x).toBe(0);
  });
});

describe("activeLayoutKey (quelle mise en page l'éditeur modifie)", () => {
  it("un format choisi garde sa mise en page", () => {
    expect(activeLayoutKey("9:16", null)).toBe("9:16");
    expect(activeLayoutKey("1:1", { width: 1920, height: 1080 })).toBe("1:1");
  });

  it("« comme la vidéo » suit la forme de la vidéo d'origine", () => {
    expect(activeLayoutKey("source", { width: 1920, height: 1080 })).toBe(
      "16:9",
    );
    expect(activeLayoutKey("source", { width: 1080, height: 1920 })).toBe(
      "9:16",
    );
    expect(activeLayoutKey("source", { width: 1000, height: 1000 })).toBe(
      "1:1",
    );
  });

  it("« comme la vidéo » sans dimensions connues : paysage", () => {
    expect(activeLayoutKey("source", null)).toBe("16:9");
  });
});

describe("repeatDelay (appui long qui répète)", () => {
  it("attend avant le premier tour, puis accélère sans jamais descendre sous le plancher", () => {
    const delays = Array.from({ length: 30 }, (_, i) => repeatDelay(i));
    expect(delays[0]).toBeGreaterThanOrEqual(300);
    for (let i = 1; i < delays.length; i++)
      expect(delays[i]).toBeLessThanOrEqual(delays[i - 1]);
    expect(Math.min(...delays)).toBeGreaterThanOrEqual(50);
    expect(delays[delays.length - 1]).toBe(Math.min(...delays));
  });

  it("un compteur invalide repart du début", () => {
    expect(repeatDelay(-3)).toBe(repeatDelay(0));
    expect(repeatDelay(Number.NaN)).toBe(repeatDelay(0));
  });
});
