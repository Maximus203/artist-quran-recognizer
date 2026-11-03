import { describe, expect, it } from "vitest";
import {
  BLUR_PX,
  drawLegibleText,
  hexToRgb,
  paintPanel,
  rgba,
  type Backdrop,
  type PanelDeps,
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

/** Fabrique de faux canevas de travail : note leur taille et tous les appels reçus par leur contexte. */
function fakeScratch() {
  const made: { w: number; h: number; calls: Call[]; canvas: object }[] = [];
  const scratch: Scratch = (w, h) => {
    const calls: Call[] = [];
    const canvas = { width: w, height: h, tag: "scratch" };
    made.push({ w, h, calls, canvas });
    const ctx = new Proxy({} as Record<string, unknown>, {
      get(t, prop: string) {
        if (prop in t) return t[prop];
        return (...args: unknown[]) => {
          calls.push({ name: prop, args });
        };
      },
      set(t, prop: string, value) {
        t[prop] = value;
        calls.push({ name: `set:${prop}`, args: [value] });
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { canvas: canvas as unknown as CanvasImageSource, ctx };
  };
  return { scratch, made };
}

/** Décor de test : une photo 3000×2000 qui couvre le cadre 1920×1080 (rognée en haut et en bas). */
function backdrop(live = false): Backdrop {
  const scale = 1920 / 3000;
  const height = 2000 * scale;
  return {
    source: { tag: "photo" } as unknown as CanvasImageSource,
    dest: { x: 0, y: (1080 - height) / 2, width: 1920, height },
    size: { width: 3000, height: 2000 },
    live,
  };
}

const rect = { x: 100, y: 200, width: 600, height: 300 };
const panel = (patch: Partial<PanelStyle>): PanelStyle => ({
  ...DEFAULT_STYLES.arabic.panel,
  ...patch,
});
const names = (calls: Call[]) => calls.map((c) => c.name);
const fillStyleOf = (call: Call) =>
  (call.args.at(-1) as { fillStyle: string }).fillStyle;

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
    expect(fillStyleOf(fill)).toBe("rgba(51, 102, 153, 1)");
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
    const alpha = Number(/, ([\d.]+)\)$/.exec(fillStyleOf(fills[0]))![1]);
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
    expect(fillStyleOf(fills[0])).toBe("rgba(6, 8, 12, 0.4)");
  });

  it("transparent à 0 % : rien à voir, rien dessiné", () => {
    const { ctx, calls } = fakeCtx();
    paintPanel(ctx, rect, panel({ kind: "transparent", opacity: 0 }), 1);
    expect(calls.filter((c) => c.name === "fill")).toEqual([]);
  });

  it("flou sans décor (dégradé ou couleur unie) : une teinte arrondie, aucun calcul de flou", () => {
    const { ctx, calls } = fakeCtx();
    const { scratch, made } = fakeScratch();
    paintPanel(
      ctx,
      rect,
      panel({ kind: "blur", opacity: 0.5, radius: 20 }),
      1,
      {
        scratch,
      },
    );
    expect(made).toHaveLength(0);
    expect(calls.some((c) => c.name === "drawImage")).toBe(false);
    expect(fillStyleOf(calls.find((c) => c.name === "fill")!)).toBe(
      "rgba(6, 8, 12, 0.5)",
    );
    expect(calls.find((c) => c.name === "roundRect")!.args[4]).toBe(20);
  });

  describe("flou d'un décor fixe (photo)", () => {
    const run = (
      over: Partial<PanelDeps> = {},
      style: Partial<PanelStyle> = {},
      scale = 1,
      r = rect,
    ) => {
      const f = fakeCtx();
      const s = fakeScratch();
      const fresh = fakeScratch();
      paintPanel(
        f.ctx,
        r,
        panel({ kind: "blur", opacity: 0.4, radius: 18, ...style }),
        scale,
        {
          scratch: s.scratch,
          fresh: fresh.scratch,
          backdrop: backdrop(),
          ...over,
        },
      );
      return { ...f, s, fresh };
    };

    it("lit le décor lui-même (jamais le canevas en cours de dessin), réduit, à la bonne zone", () => {
      const { fresh, s, canvas } = run();
      // Le petit canevas d'un décor fixe est mémorisé : il vient de la fabrique de canevas neufs.
      expect(fresh.made).toHaveLength(1);
      expect(s.made).toHaveLength(0);
      expect(fresh.made[0].w).toBeLessThan(rect.width / 4);
      expect(fresh.made[0].h).toBeLessThan(rect.height / 4);
      const copy = fresh.made[0].calls.find((c) => c.name === "drawImage")!;
      expect(copy.args[0]).not.toBe(canvas);
      expect((copy.args[0] as { tag: string }).tag).toBe("photo");
      // La photo (3000 px de large) est affichée à 64 % : on lit la zone correspondante de la photo.
      const [, sx, sy, sw, sh] = copy.args as number[];
      const k = 3000 / 1920;
      expect(sx).toBeCloseTo(100 * k, 6);
      expect(sw).toBeCloseTo(600 * k, 6);
      expect(sh).toBeCloseTo(300 * k, 6);
      expect(sy).toBeCloseTo((200 - (1080 - 1280) / 2) * k, 6);
    });

    it("garde la pièce floue OPAQUE : le petit canevas ne reçoit que la copie, ni teinte ni masque", () => {
      const { s, fresh } = run();
      for (const made of [...s.made, ...fresh.made]) {
        const names = made.calls.map((c) => c.name);
        expect(names).not.toContain("fillRect");
        expect(names).not.toContain("fill");
        expect(names).not.toContain(
          "set:globalCompositeOperation=destination-in",
        );
        expect(
          made.calls.some(
            (c) =>
              c.name === "set:globalCompositeOperation" &&
              c.args[0] === "destination-in",
          ),
        ).toBe(false);
      }
    });

    it("agrandit le petit canevas dans le rectangle arrondi, en qualité basse, puis le teinte", () => {
      const { calls, fresh } = run();
      const order = calls.map(
        (c) =>
          c.name +
          (c.name === "set:imageSmoothingQuality" ? `=${c.args[0]}` : ""),
      );
      expect(order.indexOf("roundRect")).toBeLessThan(order.indexOf("clip"));
      expect(order.indexOf("clip")).toBeLessThan(
        order.indexOf("set:imageSmoothingQuality=low"),
      );
      expect(order.indexOf("set:imageSmoothingQuality=low")).toBeLessThan(
        order.indexOf("drawImage"),
      );
      expect(order.indexOf("drawImage")).toBeLessThan(order.indexOf("fill"));
      expect(order.at(-1)).toBe("restore");
      const put = calls.find((c) => c.name === "drawImage")!;
      expect(put.args[0]).toBe(fresh.made[0].canvas);
      expect(put.args.slice(1, 5)).toEqual([100, 200, 600, 300]);
      expect(calls.find((c) => c.name === "roundRect")!.args[4]).toBe(18);
      expect(fillStyleOf(calls.find((c) => c.name === "fill")!)).toBe(
        "rgba(6, 8, 12, 0.4)",
      );
      expect(calls.some((c) => c.name === "set:filter")).toBe(false);
    });

    it("la teinte, l'opacité et l'arrondi se règlent sans refaire le flou", () => {
      const f = fakeCtx();
      const s = fakeScratch();
      const fresh = fakeScratch();
      const deps = {
        scratch: s.scratch,
        fresh: fresh.scratch,
        backdrop: backdrop(),
      };
      const style = panel({ kind: "blur", opacity: 0.4, radius: 18 });
      paintPanel(f.ctx, rect, style, 1, deps);
      paintPanel(f.ctx, rect, { ...style, opacity: 0.8 }, 1, deps);
      paintPanel(f.ctx, rect, { ...style, color: "#223344" }, 1, deps);
      paintPanel(f.ctx, rect, { ...style, radius: 60 }, 1, deps);
      expect(fresh.made).toHaveLength(1);
      expect(s.made).toHaveLength(0);
      const tints = f.calls
        .filter((c) => c.name === "fill")
        .map((c) => fillStyleOf(c));
      expect(tints).toEqual([
        "rgba(6, 8, 12, 0.4)",
        "rgba(6, 8, 12, 0.8)",
        "rgba(34, 51, 68, 0.4)",
        "rgba(6, 8, 12, 0.4)",
      ]);
    });

    it("mémorise la pièce : la deuxième image ne recalcule rien", () => {
      const f = fakeCtx();
      const s = fakeScratch();
      const fresh = fakeScratch();
      const deps = {
        scratch: s.scratch,
        fresh: fresh.scratch,
        backdrop: backdrop(),
      };
      const style = panel({ kind: "blur", opacity: 0.4, radius: 18 });
      paintPanel(f.ctx, rect, style, 1, deps);
      paintPanel(f.ctx, rect, style, 1, deps);
      paintPanel(f.ctx, rect, style, 1, deps);
      expect(s.made).toHaveLength(0);
      expect(fresh.made).toHaveLength(1);
      // Rien n'est relu dans le décor après la première image : seul l'agrandissement se refait.
      expect(
        fresh.made[0].calls.filter((c) => c.name === "drawImage"),
      ).toHaveLength(1);
      expect(f.calls.filter((c) => c.name === "drawImage")).toHaveLength(3);
    });

    it("une autre zone ou une autre force : une autre pièce", () => {
      const f = fakeCtx();
      const s = fakeScratch();
      const fresh = fakeScratch();
      const deps = {
        scratch: s.scratch,
        fresh: fresh.scratch,
        backdrop: backdrop(),
      };
      const style = panel({ kind: "blur", opacity: 0.4, radius: 18 });
      paintPanel(f.ctx, rect, style, 1, deps);
      paintPanel(f.ctx, { ...rect, y: 260 }, style, 1, deps);
      paintPanel(f.ctx, rect, style, 2, deps);
      expect(fresh.made).toHaveLength(3);
    });

    it("ne garde que les dernières pièces (mémoire bornée)", () => {
      const f = fakeCtx();
      const s = fakeScratch();
      const fresh = fakeScratch();
      const deps = {
        scratch: s.scratch,
        fresh: fresh.scratch,
        backdrop: backdrop(),
      };
      const style = panel({ kind: "blur" });
      for (let i = 0; i < 12; i++)
        paintPanel(f.ctx, { ...rect, y: 100 + i * 10 }, style, 1, deps);
      expect(fresh.made).toHaveLength(12);
      // La toute première a été oubliée : on la refait.
      paintPanel(f.ctx, { ...rect, y: 100 }, style, 1, deps);
      expect(fresh.made).toHaveLength(13);
      // La plus récente est encore là.
      paintPanel(f.ctx, { ...rect, y: 210 }, style, 1, deps);
      expect(fresh.made).toHaveLength(13);
    });

    it("la force suit la taille de la vidéo (image deux fois plus grande, flou deux fois plus large)", () => {
      expect(BLUR_PX).toBeGreaterThan(0);
      expect(run({}, {}, 2).fresh.made[0].w).toBeLessThan(
        run({}, {}, 1).fresh.made[0].w,
      );
    });

    it("un rectangle minuscule ne plante pas", () => {
      const { fresh } = run({}, {}, 1, { x: 5, y: 5, width: 1, height: 1 });
      expect(fresh.made[0].w).toBeGreaterThanOrEqual(1);
      expect(fresh.made[0].h).toBeGreaterThanOrEqual(1);
    });

    it("sans canevas de travail, ou décor sans taille : retombe sur une teinte, sans plantage", () => {
      for (const deps of [
        { fresh: () => null },
        { scratch: () => null, backdrop: backdrop(true) },
        { backdrop: { ...backdrop(), size: { width: 0, height: 0 } } },
        {
          backdrop: {
            ...backdrop(),
            dest: { x: 0, y: 0, width: 0, height: 0 },
          },
        },
      ]) {
        const { calls } = run(deps);
        expect(calls.some((c) => c.name === "fill")).toBe(true);
      }
    });
  });

  describe("flou d'un décor qui bouge (vidéo)", () => {
    const frame = (n: number) => {
      const f = fakeCtx();
      const s = fakeScratch();
      const fresh = fakeScratch();
      const deps = {
        scratch: s.scratch,
        fresh: fresh.scratch,
        backdrop: backdrop(true),
      };
      const style = panel({ kind: "blur", opacity: 0.4, radius: 18 });
      for (let i = 0; i < n; i++) paintPanel(f.ctx, rect, style, 1, deps);
      return { ...f, s, fresh };
    };

    it("refait le flou à chaque image, sans rien mettre en cache", () => {
      const { s, fresh } = frame(3);
      expect(s.made).toHaveLength(3);
      expect(fresh.made).toHaveLength(0);
    });

    it("agrandit le petit canevas dans le rectangle arrondi en qualité basse, puis le teinte", () => {
      const { calls, s } = frame(1);
      const up = calls.find((c) => c.name === "drawImage")!;
      expect(up.args[0]).toBe(s.made[0].canvas);
      expect(up.args.slice(1, 5)).toEqual([100, 200, 600, 300]);
      const order = calls.map(
        (c) =>
          c.name +
          (c.name === "set:imageSmoothingQuality" ? `=${c.args[0]}` : ""),
      );
      expect(order.indexOf("clip")).toBeLessThan(
        order.indexOf("set:imageSmoothingQuality=low"),
      );
      expect(order.indexOf("set:imageSmoothingQuality=low")).toBeLessThan(
        order.indexOf("drawImage"),
      );
      expect(order.indexOf("drawImage")).toBeLessThan(order.indexOf("fill"));
      expect(calls.some((c) => c.name === "set:filter")).toBe(false);
      expect(fillStyleOf(calls.find((c) => c.name === "fill")!)).toBe(
        "rgba(6, 8, 12, 0.4)",
      );
    });
  });

  it("restaure toujours l'état du canevas", () => {
    for (const kind of ["transparent", "blur", "solid"] as const) {
      for (const live of [false, true]) {
        const { ctx, calls } = fakeCtx();
        paintPanel(ctx, rect, panel({ kind }), 1, {
          scratch: fakeScratch().scratch,
          fresh: fakeScratch().scratch,
          backdrop: backdrop(live),
        });
        expect(calls.filter((c) => c.name === "save").length).toBe(
          calls.filter((c) => c.name === "restore").length,
        );
      }
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
