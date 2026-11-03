import { describe, expect, it } from "vitest";
import {
  createGesture,
  keyAction,
  type GestureEffect,
  type GestureHost,
} from "./export-video-gesture";
import { moveBox, pinchSize, resizeBox } from "./export-video-edit";
import type { BlockId, Box } from "./export-video-model";

const FRAME = { left: 0, top: 0, width: 1000, height: 500 };
const START: Record<BlockId, Box> = {
  arabic: { x: 0.2, y: 0.2, w: 0.4, h: 0.3 },
  translation: { x: 0.2, y: 0.55, w: 0.4, h: 0.15 },
  wave: { x: 0, y: 0.8, w: 1, h: 0.2 },
  ref: { x: 0.25, y: 0.05, w: 0.5, h: 0.06 },
};

function setup(selected: BlockId | null = null) {
  const state = { selected };
  const host: GestureHost = {
    frame: () => FRAME,
    box: (id) => START[id],
    size: (id) => (id === "wave" ? null : 1),
    selected: () => state.selected,
  };
  const gesture = createGesture(host);
  /** Rejoue les effets de sélection comme le ferait l'interface. */
  const run = (effects: GestureEffect[]): GestureEffect[] => {
    for (const effect of effects)
      if (effect.type === "select") state.selected = effect.id;
    return effects;
  };
  return { gesture, state, run };
}

const mouse = (id: number, x: number, y: number, extra = {}) => ({
  id,
  x,
  y,
  pointerType: "mouse",
  ...extra,
});
const touch = (id: number, x: number, y: number) => ({
  id,
  x,
  y,
  pointerType: "touch",
});
const types = (effects: GestureEffect[]) => effects.map((e) => e.type);
const only = <T extends GestureEffect["type"]>(
  effects: GestureEffect[],
  type: T,
): Extract<GestureEffect, { type: T }>[] =>
  effects.filter(
    (e): e is Extract<GestureEffect, { type: T }> => e.type === type,
  );

describe("toucher un élément", () => {
  it("l'appui choisit l'élément ; le relâcher sans bouger est un « toucher »", () => {
    const { gesture, run } = setup();
    expect(
      run(gesture.down(mouse(1, 300, 100), { kind: "block", id: "arabic" })),
    ).toEqual([{ type: "select", id: "arabic" }]);
    const up = gesture.up(mouse(1, 300, 100));
    expect(up).toEqual([
      { type: "tap", id: "arabic", point: { x: 0.3, y: 0.2 } },
    ]);
  });

  it("un élément déjà choisi n'est pas rechoisi à l'appui", () => {
    const { gesture } = setup("arabic");
    expect(
      gesture.down(mouse(1, 300, 100), { kind: "block", id: "arabic" }),
    ).toEqual([]);
  });

  it("un tremblement sous le seuil reste un toucher, pas un glissement", () => {
    const { gesture, run } = setup();
    run(gesture.down(touch(1, 300, 100), { kind: "block", id: "arabic" }));
    expect(gesture.move(touch(1, 305, 103))).toEqual([]);
    expect(types(gesture.up(touch(1, 305, 103)))).toEqual(["tap"]);
  });

  it("le doigt tolère un tremblement plus grand que la souris", () => {
    const { gesture } = setup();
    gesture.down(touch(1, 300, 100), { kind: "block", id: "arabic" });
    expect(gesture.move(touch(1, 307, 100))).toEqual([]);
    const { gesture: g2 } = setup();
    g2.down(mouse(1, 300, 100), { kind: "block", id: "arabic" });
    expect(only(g2.move(mouse(1, 307, 100)), "box")).toHaveLength(1);
  });

  it("toucher le fond désélectionne ; glisser sur le fond ne touche à rien (la page défile)", () => {
    const { gesture, run } = setup("arabic");
    gesture.down(touch(1, 900, 20), { kind: "background" });
    expect(run(gesture.up(touch(1, 900, 20)))).toEqual([
      { type: "select", id: null },
    ]);
    const { gesture: g2 } = setup("arabic");
    g2.down(touch(1, 900, 20), { kind: "background" });
    expect(g2.move(touch(1, 900, 200))).toEqual([]);
    expect(g2.up(touch(1, 900, 200))).toEqual([]);
  });

  it("le bouton droit de la souris ne fait rien", () => {
    const { gesture } = setup();
    expect(
      gesture.down(mouse(1, 300, 100, { button: 2 }), {
        kind: "block",
        id: "arabic",
      }),
    ).toEqual([]);
    expect(gesture.move(mouse(1, 400, 100))).toEqual([]);
  });
});

describe("glisser (déplacer)", () => {
  it("suit le doigt avec les aimants du noyau, puis valide au relâcher", () => {
    const { gesture, run } = setup();
    run(gesture.down(mouse(1, 300, 150), { kind: "block", id: "arabic" }));
    const live = only(gesture.move(mouse(1, 400, 200)), "box");
    expect(live).toHaveLength(1);
    const expected = moveBox(
      START.arabic,
      { dx: 0.1, dy: 0.1 },
      { snap: 0.01 },
    );
    expect(live[0].id).toBe("arabic");
    expect(live[0].phase).toBe("live");
    expect(live[0].box.x).toBeCloseTo(expected.box.x, 3);
    expect(live[0].box.y).toBeCloseTo(expected.box.y, 3);
    expect(live[0].box.w).toBe(START.arabic.w);

    const end = gesture.up(mouse(1, 400, 200));
    const final = only(end, "box");
    expect(final).toHaveLength(1);
    expect(final[0].phase).toBe("end");
    expect(final[0].guides).toEqual([]);
    expect(only(end, "announce")[0].text).toMatch(/^Texte arabe : centre à/);
  });

  it("s'aimante sur le centre du cadre et le montre par un repère", () => {
    const { gesture, run } = setup();
    run(gesture.down(mouse(1, 300, 150), { kind: "block", id: "arabic" }));
    // Le milieu de la boîte (x = 0,4) est amené à 0,5 : décalage de 0,1 moins 3 px d'écart.
    const [live] = only(gesture.move(mouse(1, 397, 150)), "box");
    expect(live.box.x + live.box.w / 2).toBeCloseTo(0.5, 6);
    expect(live.guides).toContainEqual({ axis: "x", at: 0.5, kind: "center" });
  });

  it("Alt coupe l'aimant", () => {
    const { gesture, run } = setup();
    run(gesture.down(mouse(1, 300, 150), { kind: "block", id: "arabic" }));
    const [live] = only(
      gesture.move(mouse(1, 397, 150, { altKey: true })),
      "box",
    );
    expect(live.guides).toEqual([]);
    expect(live.box.x).toBeCloseTo(0.2 + 0.097, 3);
  });

  it("l'aimant vaut le même nombre de pixels en largeur et en hauteur", () => {
    // Cadre 1000 × 500 : 10 px = 0,01 en x et 0,02 en y. Le milieu de la boîte est visé à y = 0,5.
    const toCenter = (0.5 - (START.arabic.y + START.arabic.h / 2)) * 500;
    const { gesture, run } = setup();
    run(gesture.down(mouse(1, 300, 150), { kind: "block", id: "arabic" }));
    // À 8 px du centre vertical (0,016 du cadre) : l'aimant prend, alors qu'il lâcherait à 0,01.
    const near = only(gesture.move(mouse(1, 300, 150 + toCenter - 8)), "box");
    expect(near[0].guides).toContainEqual({
      axis: "y",
      at: 0.5,
      kind: "center",
    });
    // À 14 px : trop loin, pas d'aimant en hauteur.
    const far = only(gesture.move(mouse(1, 300, 150 + toCenter - 14)), "box");
    expect(far[0].guides.filter((g) => g.axis === "y")).toEqual([]);
  });

  it("la boîte reste dans le cadre", () => {
    const { gesture, run } = setup();
    run(gesture.down(mouse(1, 300, 150), { kind: "block", id: "arabic" }));
    const [live] = only(gesture.move(mouse(1, 5000, -5000)), "box");
    expect(live.box.x + live.box.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(live.box.y).toBeGreaterThanOrEqual(0);
  });
});

describe("poignées (changer la zone)", () => {
  it("tirer la poignée est du redimensionnement, pas du déplacement", () => {
    const { gesture, run } = setup("arabic");
    run(
      gesture.down(mouse(1, 600, 250), {
        kind: "handle",
        id: "arabic",
        handle: "se",
      }),
    );
    const [live] = only(gesture.move(mouse(1, 700, 300)), "box");
    const expected = resizeBox(
      START.arabic,
      "se",
      { dx: 0.1, dy: 0.1 },
      { snap: 0.01, snapY: 0.02 },
    );
    expect(live.box.x).toBe(START.arabic.x);
    expect(live.box.y).toBe(START.arabic.y);
    expect(live.box.w).toBeCloseTo(expected.box.w, 3);
    expect(live.box.h).toBeCloseTo(expected.box.h, 3);
    const end = gesture.up(mouse(1, 700, 300));
    expect(only(end, "box")[0].phase).toBe("end");
  });

  it("une poignée n'agit que sur l'élément choisi", () => {
    const { gesture } = setup("translation");
    expect(
      gesture.down(mouse(1, 600, 250), {
        kind: "handle",
        id: "arabic",
        handle: "se",
      }),
    ).toEqual([]);
    expect(gesture.move(mouse(1, 700, 300))).toEqual([]);
  });

  it("toucher une poignée sans tirer ne change rien", () => {
    const { gesture } = setup("arabic");
    gesture.down(touch(1, 600, 250), {
      kind: "handle",
      id: "arabic",
      handle: "e",
    });
    expect(gesture.up(touch(1, 600, 250))).toEqual([]);
  });
});

describe("pincer (taille du texte)", () => {
  it("deux doigts : la taille suit le rapport des écarts, puis se valide", () => {
    const { gesture, run } = setup("arabic");
    run(gesture.down(touch(1, 300, 100), { kind: "block", id: "arabic" }));
    expect(
      gesture.down(touch(2, 400, 100), { kind: "block", id: "arabic" }),
    ).toEqual([]);
    const [live] = only(gesture.move(touch(2, 500, 100)), "size");
    expect(live).toEqual({
      type: "size",
      id: "arabic",
      size: pinchSize(1, 100, 200),
      phase: "live",
    });
    const end = gesture.up(touch(2, 500, 100));
    expect(only(end, "size")[0].phase).toBe("end");
    expect(only(end, "announce")[0].text).toBe("Texte arabe : taille 200 %.");
  });

  it("le doigt qui reste ne déclenche pas un glissement après le pincement", () => {
    const { gesture, run } = setup("arabic");
    run(gesture.down(touch(1, 300, 100), { kind: "block", id: "arabic" }));
    gesture.down(touch(2, 400, 100), { kind: "block", id: "arabic" });
    gesture.move(touch(2, 450, 100));
    gesture.up(touch(2, 450, 100));
    expect(gesture.move(touch(1, 600, 300))).toEqual([]);
    expect(gesture.up(touch(1, 600, 300))).toEqual([]);
  });

  it("un pincement commencé en plein glissement rend d'abord l'élément à sa place", () => {
    const { gesture, run } = setup("arabic");
    run(gesture.down(touch(1, 300, 100), { kind: "block", id: "arabic" }));
    gesture.move(touch(1, 340, 130));
    const effects = gesture.down(touch(2, 420, 100), {
      kind: "block",
      id: "arabic",
    });
    const [cancel] = only(effects, "box");
    expect(cancel).toMatchObject({ phase: "cancel", box: START.arabic });
  });

  it("choisit l'élément sous le premier doigt s'il n'y en avait pas", () => {
    const { gesture, state, run } = setup(null);
    run(gesture.down(touch(1, 300, 100), { kind: "block", id: "translation" }));
    expect(state.selected).toBe("translation");
    gesture.down(touch(2, 400, 100), { kind: "background" });
    const [live] = only(gesture.move(touch(2, 600, 100)), "size");
    expect(live.id).toBe("translation");
  });

  it("l'onde n'a pas de taille de texte : le pincement est ignoré", () => {
    const { gesture, run } = setup("wave");
    run(gesture.down(touch(1, 300, 450), { kind: "block", id: "wave" }));
    gesture.down(touch(2, 400, 450), { kind: "block", id: "wave" });
    expect(gesture.move(touch(2, 700, 450))).toEqual([]);
  });

  it("des doigts collés au départ (écart nul) ne donnent pas une taille absurde", () => {
    const { gesture, run } = setup("arabic");
    run(gesture.down(touch(1, 300, 100), { kind: "block", id: "arabic" }));
    gesture.down(touch(2, 300, 100), { kind: "block", id: "arabic" });
    expect(gesture.move(touch(2, 500, 100))).toEqual([]);
  });

  it("un troisième doigt est ignoré", () => {
    const { gesture, run } = setup("arabic");
    run(gesture.down(touch(1, 300, 100), { kind: "block", id: "arabic" }));
    gesture.down(touch(2, 400, 100), { kind: "block", id: "arabic" });
    expect(gesture.down(touch(3, 500, 100), { kind: "background" })).toEqual(
      [],
    );
    expect(only(gesture.move(touch(2, 500, 100)), "size")).toHaveLength(1);
  });
});

describe("annulation propre (pointercancel)", () => {
  it("annule un glissement : l'élément retrouve sa place de départ", () => {
    const { gesture, run } = setup();
    run(gesture.down(touch(1, 300, 150), { kind: "block", id: "arabic" }));
    gesture.move(touch(1, 400, 250));
    const effects = gesture.cancel(touch(1, 400, 250));
    expect(only(effects, "box")).toEqual([
      {
        type: "box",
        id: "arabic",
        box: START.arabic,
        guides: [],
        phase: "cancel",
      },
    ]);
    expect(gesture.move(touch(1, 450, 250))).toEqual([]);
    expect(gesture.up(touch(1, 450, 250))).toEqual([]);
  });

  it("annule un redimensionnement", () => {
    const { gesture, run } = setup("arabic");
    run(
      gesture.down(touch(1, 600, 250), {
        kind: "handle",
        id: "arabic",
        handle: "se",
      }),
    );
    gesture.move(touch(1, 700, 300));
    expect(only(gesture.cancel(touch(1, 700, 300)), "box")[0]).toMatchObject({
      phase: "cancel",
      box: START.arabic,
    });
  });

  it("annule un pincement : la taille de départ revient", () => {
    const { gesture, run } = setup("arabic");
    run(gesture.down(touch(1, 300, 100), { kind: "block", id: "arabic" }));
    gesture.down(touch(2, 400, 100), { kind: "block", id: "arabic" });
    gesture.move(touch(2, 500, 100));
    expect(only(gesture.cancel(touch(2, 500, 100)), "size")[0]).toEqual({
      type: "size",
      id: "arabic",
      size: 1,
      phase: "cancel",
    });
  });

  it("un appui simple annulé ne choisit rien de plus", () => {
    const { gesture, run } = setup("arabic");
    run(gesture.down(touch(1, 900, 20), { kind: "background" }));
    expect(gesture.cancel(touch(1, 900, 20))).toEqual([]);
  });

  it("reset (démontage du composant) annule le geste en cours", () => {
    const { gesture, run } = setup();
    run(gesture.down(mouse(1, 300, 150), { kind: "block", id: "arabic" }));
    gesture.move(mouse(1, 400, 250));
    expect(only(gesture.reset(), "box")[0]).toMatchObject({
      phase: "cancel",
      box: START.arabic,
    });
    expect(gesture.active).toBe("idle");
    expect(gesture.reset()).toEqual([]);
  });
});

describe("pointeurs inconnus", () => {
  it("un déplacement ou un relâchement sans appui ne fait rien", () => {
    const { gesture } = setup();
    expect(gesture.move(mouse(9, 10, 10))).toEqual([]);
    expect(gesture.up(mouse(9, 10, 10))).toEqual([]);
    expect(gesture.cancel(mouse(9, 10, 10))).toEqual([]);
  });

  it("l'état annoncé suit le geste", () => {
    const { gesture, run } = setup();
    expect(gesture.active).toBe("idle");
    run(gesture.down(mouse(1, 300, 150), { kind: "block", id: "arabic" }));
    expect(gesture.active).toBe("press");
    gesture.move(mouse(1, 400, 250));
    expect(gesture.active).toBe("move");
    gesture.up(mouse(1, 400, 250));
    expect(gesture.active).toBe("idle");
  });
});

describe("keyAction (clavier)", () => {
  const box: Box = { x: 0.2, y: 0.2, w: 0.4, h: 0.3 };

  it("flèches : 1 % ; Maj : 5 %", () => {
    expect(keyAction("ArrowRight", {}, box, true)).toEqual({
      type: "box",
      box: { ...box, x: 0.21 },
      zone: false,
    });
    expect(keyAction("ArrowDown", { shift: true }, box, true)).toEqual({
      type: "box",
      box: { ...box, y: 0.25 },
      zone: false,
    });
  });

  it("Ctrl (ou Cmd) + flèches change la zone", () => {
    expect(keyAction("ArrowRight", { ctrl: true }, box, true)).toEqual({
      type: "box",
      box: { ...box, w: 0.41 },
      zone: true,
    });
    expect(
      keyAction("ArrowUp", { meta: true, shift: true }, box, true),
    ).toEqual({
      type: "box",
      box: { ...box, h: 0.25 },
      zone: true,
    });
  });

  it("+ et − changent la taille, seulement si l'élément en a une", () => {
    expect(keyAction("+", {}, box, true)).toEqual({
      type: "size",
      direction: 1,
    });
    expect(keyAction("=", {}, box, true)).toEqual({
      type: "size",
      direction: 1,
    });
    expect(keyAction("-", {}, box, true)).toEqual({
      type: "size",
      direction: -1,
    });
    expect(keyAction("+", {}, box, false)).toBeNull();
  });

  it("Échap désélectionne ; Entrée et Espace choisissent", () => {
    expect(keyAction("Escape", {}, box, true)).toEqual({ type: "escape" });
    expect(keyAction("Enter", {}, box, true)).toEqual({ type: "pick" });
    expect(keyAction(" ", {}, box, true)).toEqual({ type: "pick" });
  });

  it("les autres touches (Tab…) sont laissées au navigateur", () => {
    expect(keyAction("Tab", {}, box, true)).toBeNull();
    expect(keyAction("a", {}, box, true)).toBeNull();
  });
});
