import { describe, expect, it } from "vitest";
import type { Interval } from "./recognition";
import {
  VIDEO_FPS,
  activeCardAt,
  cardLayoutFor,
  drawFrame,
  frameCountFor,
  frameCards,
  playedBarCount,
  waveBarGeometry,
  waveRectOf,
  type FrameState,
} from "./export-video-frames";
import { DEFAULT_VIDEO_PREFS } from "./export-video-prefs";
import {
  DEFAULT_LAYOUTS,
  DEFAULT_STYLES,
  type PanelStyle,
} from "./export-video-model";

const verse = (over: Partial<Interval> = {}): Interval =>
  ({
    kind: "verse",
    ref: "2:153",
    words: [1, 4],
    partial: false,
    status: "recognized",
    t: [10, 20],
    time_interpolated: false,
    confidence: 0.9,
    candidates: [],
    repetition: false,
    text: "يَا أَيُّهَا الَّذِينَ آمَنُوا",
    translation: {
      text: "Ô les croyants !",
      translation_id: "fr.hamidullah",
      attribution: "Muhammad Hamidullah",
      version: "1",
      scope: "whole",
    },
    word_times: [
      [10, 12],
      [12, 14],
      [14, 17],
      [17, 20],
    ],
    ...over,
  }) as Interval;

describe("frameCards", () => {
  it("produit une carte par verset avec ses temps de mots", () => {
    const cards = frameCards([verse()], true);
    expect(cards).toHaveLength(1);
    expect(cards[0].card.start).toBe(10);
    expect(cards[0].live?.times).toHaveLength(4);
  });

  it("honore showTranslation : pas de traduction quand désactivé", () => {
    const cards = frameCards([verse()], false);
    expect(cards[0].card.translation).toBeNull();
  });

  it("honore showArabic : pas d'arabe, la référence et la traduction restent", () => {
    const [card] = frameCards([verse()], true, false);
    expect(card.card.arabic).toBe("");
    expect(card.card.translation).not.toBeNull();
    expect(card.card.refLabel).toContain("2:153");
  });

  it("garde l'arabe par défaut", () => {
    const [card] = frameCards([verse()], false);
    expect(card.card.arabic).toBe("يَا أَيُّهَا الَّذِينَ آمَنُوا");
  });

  it("retombe sur un surlignage nul quand les temps de mots sont absents", () => {
    const cards = frameCards([verse({ word_times: undefined })], true);
    expect(cards[0].live).toBeNull();
  });
});

describe("activeCardAt", () => {
  const cards = frameCards(
    [verse(), verse({ ref: "2:154", t: [30, 40], text: "وَلَا تَقُولُوا" })],
    true,
  );

  it("retourne la carte active à l'instant t, null hors passage", () => {
    expect(activeCardAt(cards, 15)?.card.refLabel).toBe("Al-Baqara 2:153");
    expect(activeCardAt(cards, 35)?.card.refLabel).toContain("2:154");
    expect(activeCardAt(cards, 25)).toBeNull();
    expect(activeCardAt(cards, 5)).toBeNull();
  });
});

describe("playedBarCount / waveBarGeometry / frameCountFor", () => {
  it("borne la partie jouée à l'instant t", () => {
    expect(playedBarCount(100, 0, 40)).toBe(0);
    expect(playedBarCount(100, 20, 40)).toBe(50);
    expect(playedBarCount(100, 40, 40)).toBe(100);
    expect(playedBarCount(100, 999, 40)).toBe(100);
  });

  it("géométrie de l'onde : les barres remplissent la boîte, espacées comme l'atelier", () => {
    const g = waveBarGeometry({ x: 0, y: 810, width: 1920, height: 270 });
    expect(g.zoneY).toBe(810);
    expect(g.zoneH).toBe(270);
    expect(g.bars).toBe(Math.floor(1920 / 4.2));
    expect(g.pitch).toBeCloseTo(1920 / g.bars, 5);
    expect(g.barWidth).toBe(2.6);
  });

  it("une onde plus étroite : moins de barres, décalées avec la boîte", () => {
    const g = waveBarGeometry({ x: 192, y: 900, width: 1536, height: 100 });
    expect(g.zoneX).toBe(192);
    expect(g.bars).toBe(Math.floor(1536 / 4.2));
    expect(g.zoneW).toBe(1536);
  });

  it("à toute résolution l'onde a le même nombre de barres : l'aperçu montre la même onde que l'export", () => {
    const full = waveBarGeometry({ x: 0, y: 0, width: 1920, height: 200 }, 1);
    const hd = waveBarGeometry(
      { x: 0, y: 0, width: 1280, height: 133 },
      1280 / 1920,
    );
    const preview = waveBarGeometry(
      { x: 0, y: 0, width: 640, height: 66 },
      640 / 1920,
    );
    expect(Math.abs(hd.bars - full.bars)).toBeLessThanOrEqual(1);
    expect(Math.abs(preview.bars - full.bars)).toBeLessThanOrEqual(1);
    // Sans échelle donnée (1080 de référence), rien ne change.
    expect(waveBarGeometry({ x: 0, y: 0, width: 1920, height: 200 }).bars).toBe(
      full.bars,
    );
  });

  it("une boîte d'onde minuscule garde au moins une barre", () => {
    expect(waveBarGeometry({ x: 0, y: 0, width: 1, height: 1 }).bars).toBe(1);
  });

  it("la boîte de l'onde en pixels est celle de la mise en page", () => {
    const r = waveRectOf(DEFAULT_LAYOUTS["16:9"], 1920, 1080);
    expect(r.x).toBe(0);
    expect(r.y).toBeCloseTo(842.4, 6);
    expect(r.width).toBe(1920);
    expect(r.height).toBeCloseTo(237.6, 6);
  });

  it("une boîte d'onde hors cadre est ramenée dans le cadre", () => {
    const r = waveRectOf(
      { ...DEFAULT_LAYOUTS["16:9"], wave: { x: 0.9, y: 0.95, w: 0.5, h: 0.5 } },
      1000,
      1000,
    );
    expect(r.x + r.width).toBeLessThanOrEqual(1000);
    expect(r.y + r.height).toBeLessThanOrEqual(1000);
  });

  it("nombre de frames : durée × fps, arrondi supérieur, au moins 1", () => {
    expect(frameCountFor(19.02, VIDEO_FPS)).toBe(571);
    expect(frameCountFor(0.01, VIDEO_FPS)).toBe(1);
  });
});

// ── dessin d'une image, sur un faux contexte qui note ce qu'on lui demande ──────────────────────

type Call = { name: string; args: unknown[]; fillStyle?: unknown };

function fakeCanvas() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = { font: "" };
  const target = {
    canvas: { width: 1920, height: 1080 },
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    measureText: (text: string) => ({ width: text.length * 12 }),
  } as Record<string, unknown>;
  const ctx = new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      if (prop in state) return state[prop];
      return (...args: unknown[]) => {
        calls.push({ name: prop, args, fillStyle: state.fillStyle });
      };
    },
    set(_t, prop: string, value) {
      state[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, canvas: target.canvas };
}

const peaks = {
  duration: 60,
  peaks: Array.from({ length: 300 }, (_, i) => (i % 10) / 10),
};

function frameState(
  over: Partial<FrameState["prefs"]> = {},
  extra: Partial<FrameState> = {},
): FrameState {
  const cards = frameCards([verse()], true);
  return {
    width: 1920,
    height: 1080,
    t: 12,
    duration: 60,
    cards,
    peaks: peaks as FrameState["peaks"],
    colors: {
      text: "#fff",
      accent: "#d8b45a",
      wave: "#555",
      wavePlayed: "#eee",
    },
    prefs: { ...DEFAULT_VIDEO_PREFS, ...over },
    background: { color: "#101418" },
    scrim: false,
    measureContext: fakeCanvas().ctx,
    fontFamily: "Amiri",
    translationFontFamily: "Atkinson",
    ...extra,
  };
}

const withPanel = (
  block: "ref" | "arabic" | "translation",
  panel: Partial<PanelStyle>,
) => ({
  ...DEFAULT_STYLES,
  [block]: {
    ...DEFAULT_STYLES[block],
    panel: { ...DEFAULT_STYLES[block].panel, ...panel },
  },
});

describe("drawFrame : un fond et une carte", () => {
  const draw = (state: FrameState) => {
    const f = fakeCanvas();
    drawFrame(f.ctx, state);
    return f.calls;
  };
  const texts = (calls: Call[]) =>
    calls.filter((c) => c.name === "fillText").map((c) => c.args[0] as string);

  it("dessine la référence, les mots de l'arabe, la traduction et l'onde", () => {
    const calls = draw(frameState());
    const drawn = texts(calls);
    expect(drawn).toContain("Al-Baqara 2:153");
    expect(drawn).toContain("Ô les croyants !");
    // chaque mot de l'arabe est dessiné tel que le corpus le donne
    for (const word of "يَا أَيُّهَا الَّذِينَ آمَنُوا".split(" "))
      expect(drawn).toContain(word);
    expect(calls.filter((c) => c.name === "roundRect").length).toBeGreaterThan(
      100,
    );
  });

  it("les fonds sont dessinés AVANT les textes", () => {
    const calls = draw(frameState());
    const order = calls.map((c) => c.name);
    expect(order.indexOf("roundRect")).toBeLessThan(order.indexOf("fillText"));
  });

  it("sans fond de texte (« aucun »), aucun voile : le texte est lisible par son ombre", () => {
    const none = frameState({
      styles: {
        ref: withPanel("ref", { kind: "none" }).ref,
        arabic: withPanel("arabic", { kind: "none" }).arabic,
        translation: withPanel("translation", { kind: "none" }).translation,
      },
      showWave: false,
    });
    const calls = draw(none);
    expect(calls.filter((c) => c.name === "roundRect")).toHaveLength(0);
    expect(texts(calls).length).toBeGreaterThan(0);
  });

  it("le fond de l'arabe et celui de la traduction sont indépendants", () => {
    const base = frameState({ showWave: false });
    const onlyTranslation = frameState({
      showWave: false,
      styles: withPanel("arabic", { kind: "none" }),
    });
    const full = draw(base).filter((c) => c.name === "fill").length;
    const less = draw(onlyTranslation).filter((c) => c.name === "fill").length;
    expect(less).toBeLessThan(full);
    expect(less).toBeGreaterThan(0);
  });

  it("masquer la traduction ou l'arabe retire ce bloc seulement", () => {
    const noTranslation = frameCards([verse()], false);
    const calls = draw(frameState({}, { cards: noTranslation }));
    expect(texts(calls)).not.toContain("Ô les croyants !");
    expect(texts(calls)).toContain("Al-Baqara 2:153");
    const noArabic = frameCards([verse()], true, false);
    const arabicOff = texts(draw(frameState({}, { cards: noArabic })));
    expect(arabicOff).not.toContain("آمَنُوا");
    expect(arabicOff).toContain("Ô les croyants !");
  });

  it("sourate et verset se masque", () => {
    expect(texts(draw(frameState({ showRef: false })))).not.toContain(
      "Al-Baqara 2:153",
    );
  });

  it("onde masquée : aucune barre, aucun voile sous l'onde", () => {
    const withWave = draw(frameState({}, { scrim: true }));
    const without = draw(frameState({ showWave: false }, { scrim: true }));
    expect(
      withWave.filter((c) => c.name === "roundRect").length,
    ).toBeGreaterThan(
      without.filter((c) => c.name === "roundRect").length + 100,
    );
    expect(without.filter((c) => c.name === "fillRect").length).toBeLessThan(
      withWave.filter((c) => c.name === "fillRect").length,
    );
  });

  it("hors passage : le fond et l'onde seulement, aucun texte", () => {
    const calls = draw(frameState({}, { t: 5 }));
    expect(texts(calls)).toEqual([]);
    expect(calls.filter((c) => c.name === "roundRect").length).toBeGreaterThan(
      100,
    );
  });

  it("l'onde suit sa boîte : plus étroite, moins de barres", () => {
    const narrow = structuredClone(DEFAULT_LAYOUTS);
    narrow["16:9"].wave = { x: 0.25, y: 0.8, w: 0.5, h: 0.1 };
    const full = draw(frameState({}, { t: 5 })).filter(
      (c) => c.name === "roundRect",
    );
    const small = draw(frameState({ layouts: narrow }, { t: 5 })).filter(
      (c) => c.name === "roundRect",
    );
    expect(small.length).toBeLessThan(full.length * 0.6);
    const firstX = small[0].args[0] as number;
    expect(firstX).toBeGreaterThanOrEqual(1920 * 0.25);
  });

  it("la mise en page lue est celle de la forme du cadre", () => {
    const custom = structuredClone(DEFAULT_LAYOUTS);
    custom["9:16"].arabic = { x: 0.5, y: 0.2, w: 0.45, h: 0.3 };
    const portrait = frameState(
      { layouts: custom },
      { width: 1080, height: 1920 },
    );
    const card = portrait.cards[0];
    const layout = cardLayoutFor(portrait, card);
    expect(layout.arabic!.box.x).toBeCloseTo(0.5 * 1080, 6);
    const landscape = cardLayoutFor(frameState({ layouts: custom }), card);
    expect(landscape.arabic!.box.x).toBeCloseTo(0.08 * 1920, 6);
  });
});

describe("drawFrame : fond flou et décor", () => {
  const blurAll = () => {
    const styles = structuredClone(DEFAULT_STYLES);
    for (const block of ["ref", "arabic", "translation"] as const)
      styles[block].panel.kind = "blur";
    return styles;
  };
  const photo = (live = false) => {
    const source = (live
      ? { videoWidth: 4000, videoHeight: 2000, tag: "video" }
      : {
          naturalWidth: 4000,
          naturalHeight: 2000,
          tag: "photo",
        }) as unknown as CanvasImageSource;
    return source;
  };
  const scratchLog = () => {
    const made: { w: number; h: number; sources: unknown[] }[] = [];
    const scratch = (w: number, h: number) => {
      const entry = { w, h, sources: [] as unknown[] };
      made.push(entry);
      return {
        canvas: { width: w, height: h } as unknown as CanvasImageSource,
        ctx: new Proxy({} as Record<string, unknown>, {
          get(t, prop: string) {
            if (prop in t) return t[prop];
            return (...args: unknown[]) => {
              if (prop === "drawImage") entry.sources.push(args);
            };
          },
          set(t, prop: string, value) {
            t[prop] = value;
            return true;
          },
        }) as unknown as CanvasRenderingContext2D,
      };
    };
    return { made, scratch };
  };

  it("floute le décor lui-même, à la zone des textes, pas le canevas en cours de dessin", () => {
    const { made, scratch } = scratchLog();
    const f = fakeCanvas();
    drawFrame(
      f.ctx,
      frameState(
        { styles: blurAll(), showWave: false },
        {
          background: { color: "#000", image: photo() },
          panelDeps: { scratch, fresh: scratch },
        },
      ),
    );
    // Un petit canevas par fond de texte, nourri par la photo (4000×2000, affichée sur 2160×1080).
    const copies = made.flatMap((m) => m.sources);
    // Chaque petit canevas lit la PHOTO, jamais le canevas principal ; les pièces agrandies lisent le petit.
    const fromPhoto = copies.filter(
      (args) => (args as { tag?: string }[])[0].tag === "photo",
    );
    expect(fromPhoto.length).toBeGreaterThanOrEqual(3);
    for (const args of copies)
      expect((args as { tag?: string }[])[0]).not.toBe(f.canvas);
    expect(
      f.calls.filter((c) => c.name === "drawImage").length,
    ).toBeGreaterThan(1);
  });

  it("décor uni ou dégradé : le flou n'est qu'une teinte (aucun canevas de travail)", () => {
    const { made, scratch } = scratchLog();
    drawFrame(
      fakeCanvas().ctx,
      frameState(
        { styles: blurAll(), showWave: false },
        { panelDeps: { scratch, fresh: scratch } },
      ),
    );
    expect(made).toHaveLength(0);
  });

  it("une vidéo de fond est reflouée à chaque image ; une photo, une seule fois", () => {
    const countFor = (source: CanvasImageSource, frames: number) => {
      const { made, scratch } = scratchLog();
      const deps = { scratch, fresh: scratch };
      for (let i = 0; i < frames; i++)
        drawFrame(
          fakeCanvas().ctx,
          frameState(
            { styles: blurAll(), showWave: false },
            {
              t: 12 + i / 30,
              background: { color: "#000", image: source },
              panelDeps: deps,
            },
          ),
        );
      return made.length;
    };
    // Une photo par mesure : la mémoire des pièces floues est propre à chaque décor.
    const stillOnce = countFor(photo(), 1);
    expect(stillOnce).toBeGreaterThan(0);
    expect(countFor(photo(), 5)).toBe(stillOnce); // mémorisé
    // Une vidéo : le petit canevas est refait à chaque image, pour chacun des trois fonds.
    expect(countFor(photo(true), 5)).toBe(5 * 3);
  });
});

describe("cardLayoutFor : mémoire", () => {
  it("rend le même objet tant que les réglages sont les mêmes", () => {
    const state = frameState();
    const card = state.cards[0];
    expect(cardLayoutFor(state, card)).toBe(cardLayoutFor(state, card));
  });

  it("recalcule quand un style change (nouvel objet, jamais une mutation)", () => {
    const state = frameState();
    const card = state.cards[0];
    const first = cardLayoutFor(state, card);
    const bigger = structuredClone(DEFAULT_STYLES);
    bigger.arabic.size = 1.5;
    const second = cardLayoutFor(
      { ...state, prefs: { ...state.prefs, styles: bigger } },
      card,
    );
    expect(second).not.toBe(first);
    expect(second.arabic!.size).toBeGreaterThan(first.arabic!.size);
  });

  it("recalcule quand la taille du cadre change", () => {
    const state = frameState();
    const card = state.cards[0];
    const first = cardLayoutFor(state, card);
    const other = cardLayoutFor({ ...state, width: 1280, height: 720 }, card);
    expect(other).not.toBe(first);
  });
});
