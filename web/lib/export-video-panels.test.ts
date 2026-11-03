import { describe, expect, it } from "vitest";
import {
  BLUR_PX,
  drawLegibleText,
  hexToRgb,
  paintPanel,
  rgba,
  type Scratch,
} from "./export-video-panels";
import { DEFAULT_STYLES, type PanelStyle } from "./export-video-model";

type Call = { name: string; args: unknown[] };

/** Faux contexte 2D : enregistre les appels et les états posés au moment où on dessine. */
function fakeCtx() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const canvas = { width: 1920, height: 1080, tag: "main" };
  const handler: ProxyHandler<object> = {
    get(_t, prop: string) {
      if (prop === "canvas") return canvas;
      if (prop in state) return state[prop];
      return (...args: unknown[]) => {
        calls.push({
          name: prop,
          args: [...args, { fillStyle: state.fillStyle, filter: state.filter }],
        });
      };
    },
    set(_t, prop: string, value) {
      state[prop] = value;
      calls.push({ name: `set:${prop}`, args: [value] });
      return true;
    },
  };
  return {
    ctx: new Proxy({}, handler) as unknown as CanvasRenderingContext2D,
    calls,
    state,
    canvas,
  };
}

function fakeScratch() {
  const made: { w: number; h: number; drawn: unknown[][] }[] = [];
  const scratch: Scratch = (w, h) => {
    const entry = { w, h, drawn: [] as unknown[][] };
    made.push(entry);
    return {
      canvas: {
        width: w,
        height: h,
        tag: "scratch",
      } as unknown as CanvasImageSource,
      ctx: {
        drawImage: (...a: unknown[]) => entry.drawn.push(a),
        clearRect: () => undefined,
        imageSmoothingEnabled: true,
        imageSmoothingQuality: "high",
        filter: "none",
      } as unknown as CanvasRenderingContext2D,
    };
  };
  return { scratch, made };
}

const rect = { x: 100, y: 200, width: 600, height: 300 };
const panel = (patch: Partial<PanelStyle>): PanelStyle => ({
  ...DEFAULT_STYLES.arabic.panel,
  ...patch,
});
const names = (calls: Call[]) => calls.map((c) => c.name);

describe("couleurs", () => {
  it("lit un code #rrggbb, sinon revient au noir bleuté du produit", () => {
    expect(hexToRgb("#102030")).toEqual([16, 32, 48]);
    expect(hexToRgb("nimporte")).toEqual([6, 8, 12]);
    expect(hexToRgb("#12")).toEqual([6, 8, 12]);
  });

  it("compose un rgba borné", () => {
    expect(rgba("#ff0000", 0.5)).toBe("rgba(255, 0, 0, 0.5)");
    expect(rgba("#ff0000", 4)).toBe("rgba(255, 0, 0, 1)");
    expect(rgba("#ff0000", -1)).toBe("rgba(255, 0, 0, 0)");
    expect(rgba("#ff0000", Number.NaN)).toBe("rgba(255, 0, 0, 0)");
  });
});

describe("paintPanel", () => {
  it("aucun fond : ne dessine rien", () => {
    const { ctx, calls } = fakeCtx();
    paintPanel(ctx, rect, panel({ kind: "none" }), 1);
    expect(calls).toEqual([]);
  });

  it("rectangle vide ou invalide : ne dessine rien et ne plante pas", () => {
    for (const kind of ["transparent", "blur", "solid"] as const) {
      const { ctx, calls } = fakeCtx();
      paintPanel(ctx, { ...rect, width: 0 }, panel({ kind }), 1);
      paintPanel(ctx, { ...rect, height: Number.NaN }, panel({ kind }), 1);
      paintPanel(ctx, { ...rect, x: Infinity }, panel({ kind }), 1);
      expect(calls).toEqual([]);
    }
  });

  it("plein : un rectangle arrondi OPAQUE, quelle que soit l'opacité", () => {
    const { ctx, calls } = fakeCtx();
    paintPanel(
      ctx,
      rect,
      panel({ kind: "solid", color: "#336699", opacity: 0.1, radius: 20 }),
      2,
    );
    const fill = calls.find((c) => c.name === "fill")!;
    expect((fill.args.at(-1) as { fillStyle: string }).fillStyle).toBe(
      "rgba(51, 102, 153, 1)",
    );
    const rr = calls.find((c) => c.name === "roundRect")!;
    expect(rr.args.slice(0, 4)).toEqual([100, 200, 600, 300]);
    expect(rr.args[4]).toBe(40); // rayon 20 × échelle 2
  });

  it("transparent : plusieurs couches douces dont l'opacité cumulée vaut l'opacité demandée", () => {
    const { ctx, calls } = fakeCtx();
    paintPanel(
      ctx,
      rect,
      panel({ kind: "transparent", opacity: 0.66, radius: 34 }),
      1,
    );
    const fills = calls.filter((c) => c.name === "fill");
    expect(fills.length).toBe(14);
    const alpha = Number(
      /, ([\d.]+)\)$/.exec(
        (fills[0].args.at(-1) as { fillStyle: string }).fillStyle,
      )![1],
    );
    expect(1 - Math.pow(1 - alpha, 14)).toBeCloseTo(0.66, 2);
  });

  it("transparent sans arrondi : un seul rectangle net à l'opacité demandée", () => {
    const { ctx, calls } = fakeCtx();
    paintPanel(
      ctx,
      rect,
      panel({ kind: "transparent", opacity: 0.4, radius: 0 }),
      1,
    );
    const fills = calls.filter((c) => c.name === "fill");
    expect(fills).toHaveLength(1);
    expect((fills[0].args.at(-1) as { fillStyle: string }).fillStyle).toBe(
      "rgba(6, 8, 12, 0.4)",
    );
  });

  it("transparent à 0 % : rien à voir, rien dessiné", () => {
    const { ctx, calls } = fakeCtx();
    paintPanel(ctx, rect, panel({ kind: "transparent", opacity: 0 }), 1);
    expect(calls.filter((c) => c.name === "fill")).toEqual([]);
  });

  it("flou : redessine le fond flouté dans le rectangle (rogné) puis le teinte", () => {
    const { ctx, calls, canvas } = fakeCtx();
    const { scratch, made } = fakeScratch();
    paintPanel(
      ctx,
      rect,
      panel({ kind: "blur", opacity: 0.4, radius: 18 }),
      1,
      { scratch },
    );
    const order = names(calls);
    expect(order.indexOf("save")).toBeLessThan(order.indexOf("clip"));
    expect(order.indexOf("clip")).toBeLessThan(order.indexOf("drawImage"));
    expect(order.indexOf("drawImage")).toBeLessThan(order.indexOf("fill"));
    expect(order.at(-1)).toBe("restore");
    // La zone d'écran est copiée vers un petit canevas (flou en basse résolution), pas en pleine taille.
    expect(made).toHaveLength(1);
    expect(made[0].w).toBeLessThan(rect.width);
    expect(made[0].h).toBeLessThan(rect.height);
    const copied = made[0].drawn[0];
    expect(copied[0]).toBe(canvas);
    expect(copied.slice(1, 5)).toEqual([100, 200, 600, 300]);
    // Puis agrandi dans le rectangle.
    const back = calls.find((c) => c.name === "drawImage")!;
    expect(back.args.slice(1, 5)).toEqual([100, 200, 600, 300]);
    const tint = calls.filter((c) => c.name === "fill").at(-1)!;
    expect((tint.args.at(-1) as { fillStyle: string }).fillStyle).toBe(
      "rgba(6, 8, 12, 0.4)",
    );
  });

  it("flou : la force suit la taille de la vidéo (image deux fois plus grande, flou deux fois plus large)", () => {
    expect(BLUR_PX).toBeGreaterThan(0);
    const small = fakeScratch();
    const big = fakeScratch();
    paintPanel(fakeCtx().ctx, rect, panel({ kind: "blur" }), 1, {
      scratch: small.scratch,
    });
    paintPanel(fakeCtx().ctx, rect, panel({ kind: "blur" }), 2, {
      scratch: big.scratch,
    });
    // Même rectangle en pixels : plus fort = réduit davantage = canevas de travail plus petit.
    expect(big.made[0].w).toBeLessThan(small.made[0].w);
  });

  it("flou : un rectangle minuscule ne plante pas", () => {
    const { ctx } = fakeCtx();
    const { scratch, made } = fakeScratch();
    paintPanel(
      ctx,
      { x: 5, y: 5, width: 1, height: 1 },
      panel({ kind: "blur" }),
      1,
      { scratch },
    );
    expect(made[0].w).toBeGreaterThanOrEqual(1);
    expect(made[0].h).toBeGreaterThanOrEqual(1);
  });

  it("flou : sans canevas de travail disponible, retombe sur un voile teinté (pas de plantage)", () => {
    const { ctx, calls } = fakeCtx();
    paintPanel(ctx, rect, panel({ kind: "blur", opacity: 0.5 }), 1, {
      scratch: () => null,
    });
    expect(calls.some((c) => c.name === "drawImage")).toBe(false);
    expect(calls.some((c) => c.name === "fill")).toBe(true);
  });

  it("restaure toujours l'état du canevas (clip, filtre)", () => {
    for (const kind of ["transparent", "blur", "solid"] as const) {
      const { ctx, calls } = fakeCtx();
      paintPanel(ctx, rect, panel({ kind }), 1, {
        scratch: fakeScratch().scratch,
      });
      expect(calls.filter((c) => c.name === "save").length).toBe(
        calls.filter((c) => c.name === "restore").length,
      );
    }
  });
});

describe("drawLegibleText", () => {
  const draw = (style: PanelStyle, scale = 1) => {
    const f = fakeCtx();
    drawLegibleText(f.ctx, "نص", 50, 60, style, 40, scale, "#fff");
    return f;
  };

  it("avec un fond : le texte est dessiné tel quel, sans ombre ni contour", () => {
    for (const kind of ["transparent", "blur", "solid"] as const) {
      const { calls } = draw(panel({ kind }));
      expect(names(calls)).toEqual(["set:fillStyle", "fillText"]);
    }
  });

  it("sans fond, ombre douce : ombre posée pendant le tracé puis retirée", () => {
    const { calls, state } = draw(
      panel({ kind: "none", legibility: "shadow" }),
    );
    const order = names(calls);
    expect(order.indexOf("set:shadowBlur")).toBeLessThan(
      order.indexOf("fillText"),
    );
    expect(state.shadowBlur).toBe(0);
    expect(state.shadowColor).toBe("rgba(0, 0, 0, 0)");
    expect(order).not.toContain("strokeText");
  });

  it("sans fond, contour : le contour est tracé AVANT le texte", () => {
    const { calls } = draw(panel({ kind: "none", legibility: "outline" }));
    const order = names(calls);
    expect(order.indexOf("strokeText")).toBeLessThan(order.indexOf("fillText"));
    expect(order).not.toContain("set:shadowBlur");
  });

  it("l'ombre et le contour suivent l'échelle de la vidéo", () => {
    const small = draw(panel({ kind: "none", legibility: "outline" }), 1);
    const big = draw(panel({ kind: "none", legibility: "outline" }), 2);
    const width = (f: ReturnType<typeof draw>) =>
      f.calls.find((c) => c.name === "set:lineWidth")!.args[0] as number;
    expect(width(big)).toBeGreaterThan(width(small));
  });
});
