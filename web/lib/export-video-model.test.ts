import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAYOUTS,
  DEFAULT_STYLES,
  LAYOUT_KEYS,
  TEXT_BASE_SIZE,
  backgroundOf,
  exportLayoutSchema,
  layoutKeyFor,
  currentTextPosition,
  moveAllTextStacks,
  moveTextStack,
  panelSchema,
  textFreeZone,
  textPixelSize,
  textStackPosition,
  textStyleSchema,
} from "./export-video-model";

describe("mises en page par défaut", () => {
  for (const key of LAYOUT_KEYS) {
    const layout = DEFAULT_LAYOUTS[key];

    it(`${key} : valide pour le schéma et dans le cadre`, () => {
      expect(exportLayoutSchema.safeParse(layout).success).toBe(true);
      for (const box of Object.values(layout)) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.w).toBeLessThanOrEqual(1 + 1e-9);
        expect(box.y + box.h).toBeLessThanOrEqual(1 + 1e-9);
      }
    });

    it(`${key} : référence, arabe, traduction puis onde, sans chevauchement`, () => {
      const { ref, arabic, translation, wave } = layout;
      expect(ref.y + ref.h).toBeLessThanOrEqual(arabic.y + 1e-9);
      expect(arabic.y + arabic.h).toBeLessThanOrEqual(translation.y + 1e-9);
      expect(translation.y + translation.h).toBeLessThanOrEqual(wave.y + 1e-9);
    });

    it(`${key} : la pile de textes est centrée dans la zone libre (comme l'ancien réglage « centre »)`, () => {
      const position = textStackPosition(layout, key);
      expect(position).toBeGreaterThan(0.45);
      expect(position).toBeLessThan(0.55);
    });
  }

  it("l'onde par défaut occupe le bas, toute la largeur (comme avant)", () => {
    expect(DEFAULT_LAYOUTS["16:9"].wave).toEqual({
      x: 0,
      y: 0.78,
      w: 1,
      h: 0.22,
    });
    expect(DEFAULT_LAYOUTS["9:16"].wave.h).toBe(0.16);
  });

  it("les styles par défaut sont valides et à l'échelle 1", () => {
    for (const style of Object.values(DEFAULT_STYLES)) {
      expect(textStyleSchema.safeParse(style).success).toBe(true);
      expect(style.size).toBe(1);
    }
  });

  it("par défaut, la référence colle au bas de sa boîte et la traduction au haut de la sienne", () => {
    expect(DEFAULT_STYLES.ref.valign).toBe("end");
    expect(DEFAULT_STYLES.arabic.valign).toBe("center");
    expect(DEFAULT_STYLES.translation.valign).toBe("start");
  });

  it("refuse une place du texte inconnue", () => {
    expect(
      textStyleSchema.safeParse({ ...DEFAULT_STYLES.arabic, valign: "haut" })
        .success,
    ).toBe(false);
  });
});

describe("layoutKeyFor", () => {
  it("choisit la mise en page selon la forme du cadre", () => {
    expect(layoutKeyFor(1920, 1080)).toBe("16:9");
    expect(layoutKeyFor(1080, 1920)).toBe("9:16");
    expect(layoutKeyFor(1080, 1080)).toBe("1:1");
    // Vidéo d'origine en 4:3 : plus large que haute → paysage.
    expect(layoutKeyFor(1440, 1080)).toBe("16:9");
    expect(layoutKeyFor(1080, 1200)).toBe("1:1");
    expect(layoutKeyFor(1080, 1350)).toBe("9:16");
  });

  it("ne plante pas sur des dimensions absurdes", () => {
    expect(layoutKeyFor(0, 0)).toBe("16:9");
    expect(layoutKeyFor(Number.NaN, 100)).toBe("16:9");
  });
});

describe("taille du texte", () => {
  it("garde la référence « 1080 px de côté court »", () => {
    expect(textPixelSize("arabic", 1, 1920, 1080)).toBe(TEXT_BASE_SIZE.arabic);
    expect(textPixelSize("arabic", 1, 1080, 1920)).toBe(TEXT_BASE_SIZE.arabic);
    expect(textPixelSize("translation", 1, 1280, 720)).toBeCloseTo(
      TEXT_BASE_SIZE.translation * (720 / 1080),
      6,
    );
  });

  it("la taille est un facteur relatif", () => {
    expect(textPixelSize("arabic", 1.5, 1080, 1080)).toBe(
      TEXT_BASE_SIZE.arabic * 1.5,
    );
  });
});

describe("pile de textes (réglage « place du texte »)", () => {
  const zone = textFreeZone("16:9");

  it("la zone libre est celle d'avant : au-dessus de l'onde", () => {
    expect(zone.top).toBeCloseTo(0.05, 6);
    expect(zone.bottom).toBeCloseTo(1 - 0.22 - 0.025, 6);
    expect(textFreeZone("9:16").bottom).toBeCloseTo(1 - 0.16 - 0.025, 6);
  });

  it("0 colle la pile en haut, 1 en bas, sans changer ses hauteurs", () => {
    const base = DEFAULT_LAYOUTS["16:9"];
    const top = moveTextStack(base, 0, "16:9");
    const bottom = moveTextStack(base, 1, "16:9");
    expect(top.ref.y).toBeCloseTo(zone.top, 6);
    expect(bottom.translation.y + bottom.translation.h).toBeCloseTo(
      zone.bottom,
      6,
    );
    for (const id of ["ref", "arabic", "translation"] as const) {
      expect(top[id].h).toBe(base[id].h);
      expect(bottom[id].x).toBe(base[id].x);
    }
    expect(top.wave).toEqual(base.wave);
    expect(textStackPosition(top, "16:9")).toBeCloseTo(0, 6);
    expect(textStackPosition(bottom, "16:9")).toBeCloseTo(1, 6);
  });

  it("sans onde, la zone libre va jusqu'à la marge basse (comme avant)", () => {
    expect(textFreeZone("16:9", false).bottom).toBeCloseTo(0.95, 6);
    const base = DEFAULT_LAYOUTS["16:9"];
    const bottom = moveTextStack(base, 1, "16:9", false);
    expect(bottom.translation.y + bottom.translation.h).toBeCloseTo(0.95, 6);
    expect(textStackPosition(bottom, "16:9", false)).toBeCloseTo(1, 6);
    expect(bottom.wave).toEqual(base.wave);
  });

  it("borne la position à 0–1 et ne modifie pas l'original", () => {
    const base = DEFAULT_LAYOUTS["16:9"];
    const copy = structuredClone(base);
    expect(moveTextStack(base, -4, "16:9").ref.y).toBeCloseTo(zone.top, 6);
    expect(moveTextStack(base, 9, "16:9").ref.y).toBeGreaterThan(base.ref.y);
    expect(base).toEqual(copy);
    expect(moveTextStack(base, Number.NaN, "16:9")).toEqual(
      moveTextStack(base, 0.5, "16:9"),
    );
  });
});

describe("place du texte pour tous les formats", () => {
  it("recentrer la pile par défaut ne change rien (pas de sauvegarde inutile)", () => {
    expect(moveAllTextStacks(DEFAULT_LAYOUTS, 0.5)).toEqual(DEFAULT_LAYOUTS);
  });

  it("déplace la pile des trois formats, sans toucher l'onde", () => {
    const moved = moveAllTextStacks(DEFAULT_LAYOUTS, 0.88);
    for (const key of ["16:9", "9:16", "1:1"] as const) {
      expect(textStackPosition(moved[key], key)).toBeCloseTo(0.88, 6);
      expect(moved[key].wave).toEqual(DEFAULT_LAYOUTS[key].wave);
    }
  });

  it("lit la place dans le format choisi (« comme la vidéo » = paysage)", () => {
    const moved = moveAllTextStacks(DEFAULT_LAYOUTS, 0.12);
    expect(currentTextPosition(moved, "9:16", true)).toBeCloseTo(0.12, 6);
    expect(currentTextPosition(moved, "source", true)).toBeCloseTo(0.12, 6);
    const custom = structuredClone(moved);
    custom["16:9"] = DEFAULT_LAYOUTS["16:9"];
    expect(currentTextPosition(custom, "source", true)).toBeCloseTo(0.5, 6);
    expect(currentTextPosition(custom, "9:16", true)).toBeCloseTo(0.12, 6);
  });
});

describe("schémas", () => {
  it("refuse une boîte hors cadre ou trop petite", () => {
    const layout = structuredClone(DEFAULT_LAYOUTS["16:9"]);
    expect(
      exportLayoutSchema.safeParse({
        ...layout,
        arabic: { x: 0.5, y: 0.2, w: 0.8, h: 0.3 },
      }).success,
    ).toBe(false);
    expect(
      exportLayoutSchema.safeParse({
        ...layout,
        arabic: { x: 0.1, y: 0.2, w: 0.01, h: 0.3 },
      }).success,
    ).toBe(false);
    expect(exportLayoutSchema.safeParse({ ...layout, extra: 1 }).success).toBe(
      false,
    );
  });

  it("refuse un fond de texte inconnu et accepte les quatre", () => {
    for (const kind of ["none", "transparent", "blur", "solid"])
      expect(
        panelSchema.safeParse({ ...DEFAULT_STYLES.arabic.panel, kind }).success,
      ).toBe(true);
    expect(
      panelSchema.safeParse({ ...DEFAULT_STYLES.arabic.panel, kind: "glass" })
        .success,
    ).toBe(false);
    expect(
      panelSchema.safeParse({ ...DEFAULT_STYLES.arabic.panel, opacity: 2 })
        .success,
    ).toBe(false);
    expect(
      panelSchema.safeParse({ ...DEFAULT_STYLES.arabic.panel, color: "red" })
        .success,
    ).toBe(false);
  });
});

describe("backgroundOf", () => {
  const base = {
    background: null as string | null,
    bg: "#101418",
    backgroundVideo: { file: null, offset: 0, mode: "loop" as const },
  };

  it("décrit chaque type de fond", () => {
    expect(backgroundOf(base)).toEqual({ type: "auto", id: null });
    expect(backgroundOf({ ...base, background: "desert-dunes" })).toEqual({
      type: "photo",
      id: "desert-dunes",
    });
    expect(backgroundOf({ ...base, background: "nuit-doree" })).toEqual({
      type: "gradient",
      id: "nuit-doree",
    });
    expect(backgroundOf({ ...base, background: "color" })).toEqual({
      type: "color",
      id: "#101418",
    });
    expect(backgroundOf({ ...base, background: "source" })).toEqual({
      type: "source",
      id: "source",
    });
  });

  it("le fond vidéo porte son fichier, son départ et son mode", () => {
    expect(
      backgroundOf({
        ...base,
        background: "video",
        backgroundVideo: { file: "dunes.mp4", offset: 3.5, mode: "pingpong" },
      }),
    ).toEqual({
      type: "video",
      id: "dunes.mp4",
      video: { file: "dunes.mp4", offset: 3.5, mode: "pingpong" },
    });
  });

  it("un identifiant inconnu retombe sur le fond automatique", () => {
    expect(backgroundOf({ ...base, background: "inconnu" }).type).toBe("auto");
  });
});
