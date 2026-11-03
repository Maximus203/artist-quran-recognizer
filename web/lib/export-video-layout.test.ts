import { describe, expect, it } from "vitest";
import { layoutArabicWords } from "./live-highlight";
import {
  fitNote,
  layoutCard,
  wrapArabic,
  wrapTranslation,
  type LayoutInput,
} from "./export-video-layout";
import {
  DEFAULT_LAYOUTS,
  DEFAULT_STYLES,
  TEXT_BASE_SIZE,
  layoutKeyFor,
  type ExportLayout,
  type TextStyles,
} from "./export-video-model";

// Mesure factice : largeur proportionnelle au nombre de caractères.
const measure = (text: string, size: number) => text.length * size * 0.5;

const LONG_AR = Array.from({ length: 40 }, () => "كلمةطويلة").join(" ");
/** Un verset long mais réaliste : il tient dans la boîte par défaut en réduisant la taille. */
const LONG_AR_25 = Array.from({ length: 25 }, () => "كلمةطويلة").join(" ");
/** Une traduction longue mais réaliste (25 mots). */
const LONG_FR_25 = Array.from({ length: 25 }, () => "miséricordieux").join(" ");
const LONG_FR = Array.from({ length: 60 }, () => "miséricordieux").join(" ");

function input(
  width: number,
  height: number,
  over: Partial<LayoutInput> = {},
  arabic = "بسم الله الرحمن الرحيم",
  fr: string | null = "Au nom d'Allah",
): LayoutInput {
  return {
    width,
    height,
    layout: DEFAULT_LAYOUTS[layoutKeyFor(width, height)],
    styles: DEFAULT_STYLES,
    refLabel: "Al-Fatiha 1:1",
    parts: layoutArabicWords(arabic).parts,
    translation: fr,
    measureArabic: measure,
    measureTranslation: measure,
    ...over,
  };
}

const withStyle = (
  block: keyof TextStyles,
  patch: Partial<TextStyles[keyof TextStyles]>,
): TextStyles => ({
  ...DEFAULT_STYLES,
  [block]: { ...DEFAULT_STYLES[block], ...patch },
});

const withBox = (
  layout: ExportLayout,
  id: keyof ExportLayout,
  box: ExportLayout["ref"],
): ExportLayout => ({ ...layout, [id]: box });

describe("retour à la ligne", () => {
  it("coupe la traduction sans dépasser la largeur", () => {
    const lines = wrapTranslation("a bb ccc dddd eeeee", 40, 10, measure);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, 10)).toBeLessThanOrEqual(40);
    expect(lines.join(" ")).toBe("a bb ccc dddd eeeee");
  });

  it("coupe l'arabe en conservant tous les mots dans l'ordre", () => {
    const parts = layoutArabicWords("بسم الله الرحمن الرحيم").parts;
    const lines = wrapArabic(parts, 120, 20, measure);
    expect(lines.length).toBeGreaterThan(1);
    const words = lines.flatMap((l) =>
      l.parts.filter((p) => p.word !== null).map((p) => p.text),
    );
    expect(words).toEqual(["بسم", "الله", "الرحمن", "الرحيم"]);
    for (const line of lines)
      expect(line.parts[line.parts.length - 1].word).not.toBeNull();
  });
});

describe("chaque bloc dans sa boîte", () => {
  for (const [name, w, h] of [
    ["paysage", 1920, 1080],
    ["portrait", 1080, 1920],
    ["carré", 1080, 1080],
  ] as const) {
    it(`le texte reste dans la boîte de son bloc (${name})`, () => {
      const l = layoutCard(input(w, h, {}, LONG_AR_25, LONG_FR_25));
      expect(l.arabic!.overflow).toBe(false);
      expect(l.translation!.overflow).toBe(false);
      for (const id of ["ref", "arabic", "translation"] as const) {
        const block = l[id]!;
        expect(block.panel.x).toBeGreaterThanOrEqual(block.box.x - 1e-6);
        expect(block.panel.y).toBeGreaterThanOrEqual(block.box.y - 1e-6);
        expect(block.panel.x + block.panel.width).toBeLessThanOrEqual(
          block.box.x + block.box.width + 1e-6,
        );
        expect(block.panel.y + block.panel.height).toBeLessThanOrEqual(
          block.box.y + block.box.height + 1e-6,
        );
      }
      const arabic = l.arabic!;
      for (const line of arabic.lines) {
        for (const part of line.parts) {
          expect(part.x).toBeGreaterThanOrEqual(arabic.box.x - 1e-6);
          expect(part.x + part.width).toBeLessThanOrEqual(
            arabic.box.x + arabic.box.width + 1e-6,
          );
        }
        expect(line.y - (arabic.size * 1.75) / 2).toBeGreaterThanOrEqual(
          arabic.box.y - 1e-6,
        );
        expect(line.y + (arabic.size * 1.75) / 2).toBeLessThanOrEqual(
          arabic.box.y + arabic.box.height + 1e-6,
        );
      }
      const translation = l.translation!;
      const last = translation.lines.at(-1)!;
      expect(last.y + (translation.size * 1.4) / 2).toBeLessThanOrEqual(
        translation.box.y + translation.box.height + 1e-6,
      );
    });

    it(`ne touche pas l'onde et garde l'ordre référence, arabe, traduction (${name})`, () => {
      const l = layoutCard(input(w, h, {}, LONG_AR, LONG_FR));
      const wave = l.wave!;
      const last = l.translation!.lines.at(-1)!;
      expect(last.y + l.translation!.size * 0.7).toBeLessThanOrEqual(wave.y);
      expect(l.ref!.y).toBeLessThan(l.arabic!.lines[0].y);
      expect(l.arabic!.lines.at(-1)!.y).toBeLessThan(l.translation!.lines[0].y);
    });
  }

  it("l'onde reprend sa boîte en pixels", () => {
    const l = layoutCard(input(1920, 1080));
    expect(l.wave!.x).toBe(0);
    expect(l.wave!.y).toBeCloseTo(842.4, 6);
    expect(l.wave!.width).toBe(1920);
    expect(l.wave!.height).toBeCloseTo(237.6, 6);
  });

  it("un bloc suit sa boîte : l'arabe descend quand sa boîte descend", () => {
    const base = layoutCard(input(1920, 1080));
    const moved = layoutCard(
      input(1920, 1080, {
        layout: withBox(DEFAULT_LAYOUTS["16:9"], "arabic", {
          ...DEFAULT_LAYOUTS["16:9"].arabic,
          y: DEFAULT_LAYOUTS["16:9"].arabic.y + 0.05,
        }),
      }),
    );
    expect(moved.arabic!.lines[0].y).toBeCloseTo(
      base.arabic!.lines[0].y + 0.05 * 1080,
      6,
    );
    expect(moved.translation!.lines[0].y).toBeCloseTo(
      base.translation!.lines[0].y,
      6,
    );
    expect(moved.ref!.y).toBeCloseTo(base.ref!.y, 6);
  });

  it("centre le texte dans sa boîte, à gauche comme à droite", () => {
    const l = layoutCard(
      input(1920, 1080, {
        layout: withBox(DEFAULT_LAYOUTS["16:9"], "translation", {
          x: 0.1,
          y: 0.5,
          w: 0.3,
          h: 0.2,
        }),
      }),
    );
    expect(l.translation!.centerX).toBeCloseTo(0.25 * 1920, 6);
    expect(l.arabic!.centerX).toBeCloseTo(0.5 * 1920, 6);
  });

  it("garde les mots de l'arabe intacts (jamais deviné, jamais réécrit)", () => {
    const l = layoutCard(input(1080, 1920, {}, LONG_AR, LONG_FR));
    const words = l.arabic!.lines.flatMap((line) =>
      line.parts.filter((p) => p.word !== null).map((p) => p.text),
    );
    expect(words).toHaveLength(40);
    for (const word of words) expect(word).toBe("كلمةطويلة");
  });
});

describe("place du texte dans sa boîte (début, milieu, fin)", () => {
  const styleWith = (valign: "start" | "center" | "end") =>
    withStyle("arabic", { valign });
  const arabicLine = (valign: "start" | "center" | "end") =>
    layoutCard(input(1920, 1080, { styles: styleWith(valign) }, "بسم", "x"))
      .arabic!;

  it("début : le texte colle au haut de la boîte (marge du fond comprise)", () => {
    const a = arabicLine("start");
    const first = a.lines[0].y - (a.size * 1.75) / 2;
    expect(first).toBeLessThan(a.box.y + a.box.height / 3);
  });

  it("fin : le texte colle au bas de la boîte", () => {
    const a = arabicLine("end");
    const last = a.lines.at(-1)!.y + (a.size * 1.75) / 2;
    expect(last).toBeGreaterThan(a.box.y + (a.box.height * 2) / 3);
    expect(last).toBeLessThanOrEqual(a.box.y + a.box.height + 1e-6);
  });

  it("milieu : le texte est centré dans la boîte", () => {
    const a = arabicLine("center");
    const first = a.lines[0].y - (a.size * 1.75) / 2;
    const last = a.lines.at(-1)!.y + (a.size * 1.75) / 2;
    expect((first + last) / 2).toBeCloseTo(a.box.y + a.box.height / 2, 3);
  });

  it("le fond suit le texte, où qu'il soit dans la boîte", () => {
    for (const valign of ["start", "center", "end"] as const) {
      const a = arabicLine(valign);
      const first = a.lines[0].y - (a.size * 1.75) / 2;
      const last = a.lines.at(-1)!.y + (a.size * 1.75) / 2;
      expect(a.panel.y).toBeLessThanOrEqual(first + 1e-6);
      expect(a.panel.y + a.panel.height).toBeGreaterThanOrEqual(last - 1e-6);
      expect(a.panel.y).toBeGreaterThanOrEqual(a.box.y - 1e-6);
      expect(a.panel.y + a.panel.height).toBeLessThanOrEqual(
        a.box.y + a.box.height + 1e-6,
      );
    }
  });

  it("par défaut : la référence colle au bas de sa boîte, la traduction au haut de la sienne", () => {
    const l = layoutCard(input(1920, 1080));
    const refBottom = l.ref!.y + (l.ref!.size * 1.4) / 2;
    expect(refBottom).toBeGreaterThanOrEqual(
      l.ref!.box.y + l.ref!.box.height * 0.8 - 1e-6,
    );
    const firstTranslation =
      l.translation!.lines[0].y - (l.translation!.size * 1.4) / 2;
    expect(firstTranslation).toBeLessThan(
      l.translation!.box.y + l.translation!.box.height * 0.4,
    );
  });
});

describe("taille, réduction et remplissage par bloc", () => {
  it("garde la taille choisie quand tout tient", () => {
    const l = layoutCard(input(1920, 1080, {}, "بسم الله", "Au nom de Dieu"));
    expect(l.arabic!.fit).toBe(1);
    expect(l.arabic!.size).toBe(TEXT_BASE_SIZE.arabic);
    expect(l.arabic!.note).toBeNull();
    expect(l.translation!.fit).toBe(1);
    expect(l.arabic!.lines).toHaveLength(1);
  });

  it("la taille est un facteur : 1,5 donne 1,5 fois la taille de référence", () => {
    const l = layoutCard(
      input(
        1920,
        1080,
        { styles: withStyle("arabic", { size: 1.5 }) },
        "بسم",
        "x",
      ),
    );
    expect(l.arabic!.size).toBeCloseTo(TEXT_BASE_SIZE.arabic * 1.5, 6);
  });

  it("réduit seulement le bloc trop long et le dit", () => {
    const l = layoutCard(input(1920, 1080, {}, LONG_AR, "Au nom d'Allah"));
    expect(l.arabic!.fit).toBeLessThan(1);
    expect(l.arabic!.note).toMatch(/^réduit à \d+ %$/);
    expect(l.arabic!.overflow).toBe(false);
    expect(l.translation!.fit).toBe(1);
    expect(l.translation!.note).toBeNull();
  });

  it("ne réduit pas plus que nécessaire : la taille trouvée est la plus grande qui tient", () => {
    for (const words of [6, 9, 12, 16, 20, 26, 33]) {
      const arabic = Array.from({ length: words }, () => "كلمةطويلة").join(" ");
      const l = layoutCard(input(1920, 1080, {}, arabic, "x"));
      const block = l.arabic!;
      const parts = layoutArabicWords(arabic).parts;
      // Cherche, par balayage, le plus grand facteur qui tient dans la boîte.
      let best = 0.4;
      for (let fit = 1; fit >= 0.4; fit -= 0.002) {
        const size = TEXT_BASE_SIZE.arabic * fit;
        const lines = wrapArabic(parts, block.box.width, size, measure);
        const height = lines.length * size * 1.75;
        const widest = Math.max(...lines.map((x) => x.width));
        if (
          height <= block.box.height + 0.5 &&
          widest <= block.box.width + 0.5
        ) {
          best = fit;
          break;
        }
      }
      expect(block.fit).toBeLessThanOrEqual(1);
      expect(block.fit).toBeGreaterThanOrEqual(best - 0.015);
    }
  });

  it("le pourcentage annoncé est celui de la réduction réelle", () => {
    const l = layoutCard(input(1920, 1080, {}, LONG_AR, LONG_FR));
    const block = l.translation!;
    expect(block.note).toBe(`réduit à ${Math.round(block.fit * 100)} %`);
    expect(block.size).toBeCloseTo(
      TEXT_BASE_SIZE.translation * (1080 / 1080) * block.fit,
      6,
    );
  });

  it("une boîte trop petite pour le texte : plancher de réduction et signal de débordement", () => {
    const l = layoutCard(
      input(
        1920,
        1080,
        {
          layout: withBox(DEFAULT_LAYOUTS["16:9"], "arabic", {
            x: 0.4,
            y: 0.3,
            w: 0.12,
            h: 0.05,
          }),
        },
        LONG_AR,
      ),
    );
    expect(l.arabic!.fit).toBeCloseTo(0.4, 6);
    expect(l.arabic!.overflow).toBe(true);
  });

  it("un mot plus large que la boîte réduit aussi le bloc", () => {
    const narrow = withBox(DEFAULT_LAYOUTS["16:9"], "arabic", {
      x: 0.4,
      y: 0.2,
      w: 0.12,
      h: 0.4,
    });
    const l = layoutCard(
      input(1920, 1080, { layout: narrow }, "اااااااااااااااا"),
    );
    expect(l.arabic!.fit).toBeLessThan(1);
    const line = l.arabic!.lines[0];
    expect(line.width).toBeLessThanOrEqual(l.arabic!.box.width + 1e-6);
  });

  it("remplir agrandit le bloc jusqu'à sa boîte, sans la dépasser", () => {
    const normal = layoutCard(input(1920, 1080, {}, "بسم الله الرحمن الرحيم"));
    const fill = layoutCard(
      input(
        1920,
        1080,
        { styles: withStyle("arabic", { fill: true }) },
        "بسم الله الرحمن الرحيم",
      ),
    );
    expect(fill.arabic!.size).toBeGreaterThan(normal.arabic!.size * 1.5);
    expect(fill.arabic!.fit).toBeGreaterThan(1);
    expect(fill.arabic!.note).toMatch(/^agrandi à \d+ %$/);
    expect(fill.arabic!.overflow).toBe(false);
    const lines = fill.arabic!.lines;
    expect(
      lines.at(-1)!.y + (fill.arabic!.size * 1.75) / 2,
    ).toBeLessThanOrEqual(fill.arabic!.box.y + fill.arabic!.box.height + 1e-6);
    // Les autres blocs ne grandissent pas.
    expect(fill.translation!.size).toBe(normal.translation!.size);
  });

  it("remplir ne dépasse jamais quatre fois la taille choisie", () => {
    const fill = layoutCard(
      input(1920, 1080, { styles: withStyle("ref", { fill: true }) }, "بسم"),
    );
    expect(fill.ref!.fit).toBeLessThanOrEqual(4 + 1e-9);
  });

  it("la taille d'un bloc ne change pas celle d'un autre", () => {
    const small = layoutCard(
      input(1920, 1080, { styles: withStyle("translation", { size: 0.5 }) }),
    );
    const base = layoutCard(input(1920, 1080));
    expect(small.translation!.size).toBeCloseTo(base.translation!.size / 2, 6);
    expect(small.arabic!.size).toBe(base.arabic!.size);
  });

  it("agrandit les écritures en portrait comme en paysage (échelle sur le côté court)", () => {
    const portrait = layoutCard(input(1080, 1920, {}, "بسم", "Au nom"));
    const landscape = layoutCard(input(1920, 1080, {}, "بسم", "Au nom"));
    expect(portrait.arabic!.size).toBe(landscape.arabic!.size);
  });

  it("fitNote : réduit, agrandi, ou rien", () => {
    expect(fitNote(0.87)).toBe("réduit à 87 %");
    expect(fitNote(1)).toBeNull();
    expect(fitNote(0.999)).toBeNull();
    expect(fitNote(1.4)).toBe("agrandi à 140 %");
  });
});

describe("la référence", () => {
  it("la référence trop large pour sa boîte est réduite, jamais coupée", () => {
    const l = layoutCard(
      input(1920, 1080, {
        refLabel: "Al-Baqara 2:255 ".repeat(8).trim(),
        layout: withBox(DEFAULT_LAYOUTS["16:9"], "ref", {
          x: 0.4,
          y: 0.07,
          w: 0.2,
          h: 0.07,
        }),
      }),
    );
    expect(l.ref!.fit).toBeLessThan(1);
    expect(l.ref!.text).toBe("Al-Baqara 2:255 ".repeat(8).trim());
  });

  it("la référence se masque", () => {
    expect(layoutCard(input(1920, 1080, { showRef: false })).ref).toBeNull();
  });
});

describe("fond du texte : rectangle", () => {
  it("épouse le texte quand l'étendue est « texte » (jamais plus grand que la boîte)", () => {
    const l = layoutCard(input(1920, 1080, {}, "بسم", "Au nom"));
    const t = l.translation!;
    expect(t.panel.width).toBeLessThan(t.box.width);
    expect(t.panel.height).toBeLessThan(t.box.height);
    expect(t.panel.x + t.panel.width / 2).toBeCloseTo(t.centerX, 6);
  });

  it("prend toute la boîte quand l'étendue est « boîte »", () => {
    const style = {
      ...DEFAULT_STYLES.translation,
      panel: { ...DEFAULT_STYLES.translation.panel, extent: "box" as const },
    };
    const l = layoutCard(
      input(1920, 1080, { styles: { ...DEFAULT_STYLES, translation: style } }),
    );
    expect(l.translation!.panel).toEqual(l.translation!.box);
  });

  it("le fond de l'arabe et celui de la traduction sont indépendants", () => {
    const l = layoutCard(input(1920, 1080, {}, "بسم الله", "Au nom d'Allah"));
    expect(l.arabic!.panel).not.toEqual(l.translation!.panel);
    expect(l.arabic!.panel.y + l.arabic!.panel.height).toBeLessThanOrEqual(
      l.translation!.panel.y + 1e-6,
    );
  });

  it("une boîte minuscule garde un fond à l'intérieur d'elle-même", () => {
    const tiny = { x: 0.4, y: 0.4, w: 0.1, h: 0.04 };
    const l = layoutCard(
      input(1920, 1080, {
        layout: withBox(DEFAULT_LAYOUTS["16:9"], "ref", tiny),
      }),
    );
    const { box, panel } = l.ref!;
    expect(panel.x).toBeGreaterThanOrEqual(box.x - 1e-6);
    expect(panel.y + panel.height).toBeLessThanOrEqual(
      box.y + box.height + 1e-6,
    );
  });
});

describe("traduction, attribution et blocs masqués", () => {
  it("sans traduction : aucun bloc traduction", () => {
    expect(
      layoutCard(input(1920, 1080, {}, "بسم", null)).translation,
    ).toBeNull();
    expect(layoutCard(input(1920, 1080, {}, "بسم", "")).translation).toBeNull();
    expect(
      layoutCard(input(1920, 1080, {}, "بسم", "   ")).translation,
    ).toBeNull();
  });

  it("sans arabe (écriture masquée) : aucun bloc arabe, la traduction reste", () => {
    const l = layoutCard(input(1920, 1080, {}, ""));
    expect(l.arabic).toBeNull();
    expect(l.translation).not.toBeNull();
    expect(l.ref).not.toBeNull();
  });

  it("onde masquée : pas de rectangle d'onde", () => {
    expect(layoutCard(input(1920, 1080, { showWave: false })).wave).toBeNull();
  });

  it("l'attribution reste collée à la traduction, dans sa boîte et son fond (I2)", () => {
    const l = layoutCard(
      input(
        1920,
        1080,
        { attribution: "QuranEnc.com · traduction française" },
        "بسم",
        "Au nom d'Allah",
      ),
    );
    const t = l.translation!;
    expect(t.attribution).not.toBeNull();
    expect(t.attribution!.lines.join(" ")).toBe(
      "QuranEnc.com · traduction française",
    );
    expect(t.attribution!.y).toBeGreaterThan(t.lines.at(-1)!.y);
    expect(t.attribution!.size).toBeLessThan(t.size);
    expect(t.attribution!.y).toBeLessThanOrEqual(t.box.y + t.box.height);
    expect(t.panel.y + t.panel.height).toBeGreaterThanOrEqual(
      t.attribution!.y + t.attribution!.size * 0.5,
    );
  });

  it("la traduction n'est jamais modifiée : mots et ordre conservés", () => {
    const text = "Allah ! Pas de divinité à part Lui, le Vivant.";
    const l = layoutCard(input(1080, 1920, {}, "بسم", text));
    expect(l.translation!.lines.map((x) => x.text).join(" ")).toBe(text);
  });

  it("pas d'attribution sans traduction", () => {
    const l = layoutCard(
      input(1920, 1080, { attribution: "QuranEnc.com" }, "بسم", null),
    );
    expect(l.translation).toBeNull();
  });

  it("l'attribution compte dans la place : elle peut faire réduire la traduction, jamais sortir", () => {
    const plain = layoutCard(input(1920, 1080, {}, "بسم", LONG_FR));
    const withAttr = layoutCard(
      input(1920, 1080, { attribution: "QuranEnc.com" }, "بسم", LONG_FR),
    );
    expect(withAttr.translation!.fit).toBeLessThanOrEqual(
      plain.translation!.fit,
    );
    expect(
      withAttr.translation!.attribution!.y +
        withAttr.translation!.attribution!.size * 0.5,
    ).toBeLessThanOrEqual(
      withAttr.translation!.box.y + withAttr.translation!.box.height + 1e-6,
    );
  });
});

describe("cas limites", () => {
  it("boîte hors cadre : ramenée dans le cadre, rien ne sort de la vidéo", () => {
    const l = layoutCard(
      input(1920, 1080, {
        layout: withBox(DEFAULT_LAYOUTS["16:9"], "arabic", {
          x: 0.9,
          y: 0.95,
          w: 0.5,
          h: 0.5,
        }),
      }),
    );
    const { box } = l.arabic!;
    expect(box.x + box.width).toBeLessThanOrEqual(1920 + 1e-6);
    expect(box.y + box.height).toBeLessThanOrEqual(1080 + 1e-6);
    for (const line of l.arabic!.lines)
      for (const part of line.parts) expect(part.x).toBeGreaterThanOrEqual(0);
  });

  it("cadre sans dimension : aucun bloc, pas de plantage", () => {
    const l = layoutCard(input(0, 0));
    expect(l.ref).toBeNull();
    expect(l.arabic).toBeNull();
    expect(l.translation).toBeNull();
    expect(l.wave).toBeNull();
  });

  it("très petit cadre (360p) : tout reste fini et dans le cadre", () => {
    const l = layoutCard(input(640, 360, {}, LONG_AR, LONG_FR));
    for (const id of ["ref", "arabic", "translation"] as const) {
      const p = l[id]!.panel;
      for (const n of [p.x, p.y, p.width, p.height])
        expect(Number.isFinite(n)).toBe(true);
      expect(p.x + p.width).toBeLessThanOrEqual(640 + 1e-6);
      expect(p.y + p.height).toBeLessThanOrEqual(360 + 1e-6);
    }
  });

  it("la référence garde une taille lisible au minimum : 14 px dans la vidéo de référence de 1080 px", () => {
    const tiny = {
      styles: {
        ...DEFAULT_STYLES,
        ref: { ...DEFAULT_STYLES.ref, size: 0.4 },
      },
    };
    const l = layoutCard(input(1920, 1080, tiny));
    expect(l.ref!.size).toBeGreaterThanOrEqual(14);
    // Le plancher suit l'échelle : la même demande à 720p donne le même plancher, proportionnellement.
    const small = layoutCard(input(1280, 720, tiny));
    expect(small.ref!.size / 720).toBeCloseTo(l.ref!.size / 1080, 3);
  });

  it("l'aperçu et l'export montrent la référence à la MÊME taille relative (ce qu'on voit est ce qui sort)", () => {
    const preview = layoutCard(input(640, 360));
    const full = layoutCard(input(1920, 1080));
    const hd = layoutCard(input(1280, 720));
    expect(preview.ref!.size / 360).toBeCloseTo(full.ref!.size / 1080, 4);
    expect(hd.ref!.size / 720).toBeCloseTo(full.ref!.size / 1080, 4);
  });
});
