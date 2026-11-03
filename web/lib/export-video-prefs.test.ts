import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_PREFS,
  isLegacyVideoPrefs,
  layoutFor,
  migrateVideoPrefs,
  sanitizeVideoPrefs,
  videoPrefsSchema,
} from "./export-video-prefs";
import {
  DEFAULT_LAYOUTS,
  DEFAULT_STYLES,
  TEXT_BASE_SIZE,
  textStackPosition,
} from "./export-video-model";

/** Les réglages à plat d'avant le modèle à blocs, tels que le serveur les a enregistrés. */
const LEGACY_DEFAULTS = {
  orientation: "16:9",
  arabicSize: 72,
  translationSize: 30,
  showTranslation: true,
  showArabic: true,
  resolution: 1080,
  fps: 30,
  bg: "#101418",
  background: null,
  fill: false,
  textPosition: 50,
  showWave: true,
  accent: null,
  paddingBefore: 0.6,
  paddingAfter: 0.4,
  snapToSilence: true,
};

describe("videoPrefsSchema (modèle à blocs)", () => {
  it("valide les valeurs par défaut", () => {
    expect(videoPrefsSchema.parse(DEFAULT_VIDEO_PREFS)).toEqual(
      DEFAULT_VIDEO_PREFS,
    );
  });

  it("les défauts portent trois mises en page, trois styles et un fond vidéo neutre", () => {
    expect(DEFAULT_VIDEO_PREFS.layouts).toEqual(DEFAULT_LAYOUTS);
    expect(DEFAULT_VIDEO_PREFS.styles).toEqual(DEFAULT_STYLES);
    expect(DEFAULT_VIDEO_PREFS.backgroundVideo).toEqual({
      file: null,
      offset: 0,
      mode: "loop",
    });
    expect(DEFAULT_VIDEO_PREFS.showRef).toBe(true);
  });

  it("affiche l'arabe quand le réglage mémorisé est antérieur à l'option", () => {
    const { showArabic: _omitted, ...previous } = DEFAULT_VIDEO_PREFS;
    expect(videoPrefsSchema.parse(previous).showArabic).toBe(true);
  });

  it("complète les blocs absents sans partager d'objet avec les défauts", () => {
    const { layouts: _l, styles: _s, ...rest } = DEFAULT_VIDEO_PREFS;
    const parsed = videoPrefsSchema.parse({
      ...rest,
      // Un seul des deux présent : le nouveau modèle, l'autre est complété.
      styles: DEFAULT_VIDEO_PREFS.styles,
    });
    parsed.layouts["16:9"].arabic.x = 0.5;
    expect(DEFAULT_LAYOUTS["16:9"].arabic.x).toBe(0.08);
  });

  it("refuse une orientation inconnue", () => {
    expect(
      videoPrefsSchema.safeParse({ ...DEFAULT_VIDEO_PREFS, orientation: "4:3" })
        .success,
    ).toBe(false);
  });

  it("refuse une clé inconnue (y compris un ancien champ mêlé au nouveau modèle)", () => {
    expect(
      videoPrefsSchema.safeParse({ ...DEFAULT_VIDEO_PREFS, arabicSize: 72 })
        .success,
    ).toBe(false);
    expect(
      videoPrefsSchema.safeParse({ ...DEFAULT_VIDEO_PREFS, truc: 1 }).success,
    ).toBe(false);
  });

  it("refuse une taille de texte, un fond de texte ou une boîte invalides", () => {
    const bad = (patch: object) =>
      videoPrefsSchema.safeParse({ ...DEFAULT_VIDEO_PREFS, ...patch }).success;
    const style = (patch: object) => ({
      ...DEFAULT_STYLES,
      arabic: { ...DEFAULT_STYLES.arabic, ...patch },
    });
    expect(bad({ styles: style({ size: 9 }) })).toBe(false);
    expect(bad({ styles: style({ size: 0.1 }) })).toBe(false);
    expect(
      bad({
        styles: style({
          panel: { ...DEFAULT_STYLES.arabic.panel, kind: "glass" },
        }),
      }),
    ).toBe(false);
    expect(
      bad({
        layouts: {
          ...DEFAULT_LAYOUTS,
          "16:9": {
            ...DEFAULT_LAYOUTS["16:9"],
            arabic: { x: 0.9, y: 0.1, w: 0.5, h: 0.2 },
          },
        },
      }),
    ).toBe(false);
  });

  it("refuse un accent hors bornes et un fond vidéo invalide", () => {
    expect(
      videoPrefsSchema.safeParse({
        ...DEFAULT_VIDEO_PREFS,
        accent: { h: 400, s: 50, l: 50, a: 1 },
      }).success,
    ).toBe(false);
    expect(
      videoPrefsSchema.safeParse({
        ...DEFAULT_VIDEO_PREFS,
        backgroundVideo: { file: "a.mp4", offset: -1, mode: "loop" },
      }).success,
    ).toBe(false);
    expect(
      videoPrefsSchema.safeParse({
        ...DEFAULT_VIDEO_PREFS,
        backgroundVideo: { file: "a.mp4", offset: 3, mode: "rebond" },
      }).success,
    ).toBe(false);
    expect(
      videoPrefsSchema.safeParse({
        ...DEFAULT_VIDEO_PREFS,
        backgroundVideo: { file: "a.mp4", offset: 3, mode: "freeze" },
      }).success,
    ).toBe(true);
  });
});

describe("plafond de résolution : 1080p", () => {
  it("ramène un ancien réglage 1440p ou 4K à 1080p au lieu de le refuser", () => {
    for (const resolution of [1440, 2160]) {
      const parsed = videoPrefsSchema.safeParse({
        ...DEFAULT_VIDEO_PREFS,
        resolution,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.resolution).toBe(1080);
    }
  });

  it("garde les résolutions inférieures et refuse une valeur inconnue", () => {
    for (const resolution of [360, 480, 720, 1080])
      expect(
        videoPrefsSchema.parse({ ...DEFAULT_VIDEO_PREFS, resolution })
          .resolution,
      ).toBe(resolution);
    expect(
      videoPrefsSchema.safeParse({ ...DEFAULT_VIDEO_PREFS, resolution: 999 })
        .success,
    ).toBe(false);
  });
});

describe("migration des anciens réglages à plat", () => {
  const migrate = (patch: object = {}) =>
    videoPrefsSchema.parse({ ...LEGACY_DEFAULTS, ...patch });

  it("reconnaît l'ancien format", () => {
    expect(isLegacyVideoPrefs(LEGACY_DEFAULTS)).toBe(true);
    expect(isLegacyVideoPrefs({ orientation: "16:9", bg: "#101418" })).toBe(
      true,
    );
    expect(isLegacyVideoPrefs(DEFAULT_VIDEO_PREFS)).toBe(false);
    expect(isLegacyVideoPrefs(null)).toBe(false);
    expect(isLegacyVideoPrefs([])).toBe(false);
    expect(isLegacyVideoPrefs("x")).toBe(false);
  });

  it("un compte aux réglages par défaut d'avant retrouve exactement les défauts d'aujourd'hui", () => {
    expect(migrate()).toEqual(DEFAULT_VIDEO_PREFS);
  });

  it("les tailles deviennent des échelles relatives (72 → 1, 30 → 1)", () => {
    const m = migrate({ arabicSize: 120, translationSize: 52 });
    expect(m.styles.arabic.size).toBeCloseTo(120 / 72, 3);
    expect(m.styles.translation.size).toBeCloseTo(52 / 30, 3);
    // Les pixels obtenus sont ceux d'avant.
    expect(m.styles.arabic.size * TEXT_BASE_SIZE.arabic).toBeCloseTo(120, 1);
    expect(m.styles.translation.size * TEXT_BASE_SIZE.translation).toBeCloseTo(
      52,
      1,
    );
    // La référence suivait l'arabe.
    expect(m.styles.ref.size).toBeCloseTo(m.styles.arabic.size, 3);
  });

  it("garde les tailles aux bornes d'avant", () => {
    const small = migrate({ arabicSize: 40, translationSize: 16 });
    expect(small.styles.arabic.size).toBeCloseTo(40 / 72, 3);
    const big = migrate({ arabicSize: 240, translationSize: 140 });
    expect(big.styles.arabic.size).toBeCloseTo(240 / 72, 3);
    expect(big.styles.translation.size).toBeLessThanOrEqual(5);
  });

  it("la place du texte (0–100) déplace la pile dans chaque orientation", () => {
    for (const [textPosition, expected] of [
      [0, 0],
      [12, 0.12],
      [50, 0.5],
      [88, 0.88],
      [100, 1],
    ] as const) {
      const m = migrate({ textPosition });
      for (const key of ["16:9", "9:16", "1:1"] as const) {
        const position = textStackPosition(m.layouts[key], key);
        // Les boîtes par défaut sont centrées à ≈ 0,5 près : l'écart reste faible.
        expect(Math.abs(position - expected)).toBeLessThan(0.001);
      }
    }
  });

  it("sans onde, la place du texte se compte sur la zone élargie d'avant", () => {
    const m = migrate({ showWave: false, textPosition: 50 });
    for (const key of ["16:9", "9:16", "1:1"] as const) {
      expect(textStackPosition(m.layouts[key], key, false)).toBeCloseTo(0.5, 6);
      // Le texte descend donc plus bas que dans la zone avec onde.
      expect(m.layouts[key].translation.y).toBeGreaterThan(
        DEFAULT_LAYOUTS[key].translation.y,
      );
    }
  });

  it("l'onde ne bouge pas avec la place du texte", () => {
    expect(migrate({ textPosition: 10 }).layouts["16:9"].wave).toEqual(
      DEFAULT_LAYOUTS["16:9"].wave,
    );
  });

  it("« remplir » devient « remplir la zone » pour l'arabe et la traduction", () => {
    const m = migrate({ fill: true });
    expect(m.styles.arabic.fill).toBe(true);
    expect(m.styles.translation.fill).toBe(true);
    expect(m.styles.ref.fill).toBe(false);
  });

  it("garde les écritures, l'onde, la résolution, la cadence, l'accent, le fond et les marges", () => {
    const accent = { h: 200, s: 50, l: 60, a: 0.9 };
    const m = migrate({
      orientation: "9:16",
      showTranslation: false,
      showArabic: false,
      showWave: false,
      resolution: 720,
      fps: 60,
      accent,
      bg: "#223344",
      background: "desert-dunes",
      paddingBefore: 1.5,
      paddingAfter: 2,
      snapToSilence: false,
    });
    expect(m).toMatchObject({
      orientation: "9:16",
      showTranslation: false,
      showArabic: false,
      showWave: false,
      resolution: 720,
      fps: 60,
      accent,
      bg: "#223344",
      background: "desert-dunes",
      paddingBefore: 1.5,
      paddingAfter: 2,
      snapToSilence: false,
    });
  });

  it("un ancien 1440p revient à 1080p", () => {
    expect(migrate({ resolution: 1440 }).resolution).toBe(1080);
  });

  it("le voile derrière le texte suit le fond choisi : photo → voile ; dégradé ou couleur → ombre", () => {
    const soft = DEFAULT_STYLES.arabic.panel;
    expect(migrate({ background: "desert-dunes" }).styles.arabic.panel).toEqual(
      soft,
    );
    expect(migrate({ background: null }).styles.translation.panel).toEqual(
      soft,
    );
    expect(migrate({ background: "source" }).styles.arabic.panel).toEqual(soft);
    for (const background of ["nuit-doree", "emeraude", "color"]) {
      const m = migrate({ background });
      expect(m.styles.arabic.panel.kind).toBe("none");
      expect(m.styles.translation.panel.kind).toBe("none");
    }
  });

  it("des réglages très anciens (champs manquants) prennent les défauts", () => {
    const m = videoPrefsSchema.parse({
      orientation: "16:9",
      arabicSize: 72,
      translationSize: 30,
      showTranslation: true,
      bg: "#101418",
    });
    expect(m).toEqual(DEFAULT_VIDEO_PREFS);
  });

  it("valeurs corrompues : défauts, jamais d'échec", () => {
    const m = migrate({
      orientation: "4:3",
      arabicSize: "énorme",
      translationSize: Number.NaN,
      showTranslation: "oui",
      showArabic: 3,
      resolution: 999,
      fps: 24,
      fill: "peut-être",
      textPosition: 999,
      showWave: null,
      accent: { h: 999 },
      bg: "rouge",
      background: 42,
      paddingBefore: -4,
      paddingAfter: "x",
      snapToSilence: "non",
    });
    expect(m).toEqual(DEFAULT_VIDEO_PREFS);
  });

  it("tailles hors bornes d'avant : ramenées au défaut", () => {
    const m = migrate({ arabicSize: 10, translationSize: 9999 });
    expect(m.styles.arabic.size).toBe(1);
    expect(m.styles.translation.size).toBe(1);
  });

  it("un objet vide ou de clés inconnues donne les défauts", () => {
    expect(videoPrefsSchema.parse({})).toEqual(DEFAULT_VIDEO_PREFS);
    expect(videoPrefsSchema.parse({ truc: 1, bidule: [] })).toEqual(
      DEFAULT_VIDEO_PREFS,
    );
  });

  it("une valeur qui n'est pas un objet reste refusée (le serveur retombe alors sur les défauts)", () => {
    for (const raw of [null, undefined, 3, "x", [], true])
      expect(videoPrefsSchema.safeParse(raw).success).toBe(false);
  });

  it("migrateVideoPrefs ne touche pas un objet déjà au nouveau format", () => {
    expect(migrateVideoPrefs(DEFAULT_VIDEO_PREFS)).toBe(DEFAULT_VIDEO_PREFS);
  });

  it("l'ancien format n'est pas muté", () => {
    const old = { ...LEGACY_DEFAULTS };
    migrate();
    videoPrefsSchema.parse(old);
    expect(old).toEqual(LEGACY_DEFAULTS);
  });
});

describe("sanitizeVideoPrefs (récupération champ par champ)", () => {
  it("rend toujours des réglages valides, quoi qu'on lui donne", () => {
    for (const raw of [
      null,
      undefined,
      42,
      "x",
      [],
      {},
      { layouts: 3, styles: "x" },
      { layouts: { "16:9": null }, styles: { arabic: { size: "gros" } } },
    ])
      expect(videoPrefsSchema.safeParse(sanitizeVideoPrefs(raw)).success).toBe(
        true,
      );
    expect(sanitizeVideoPrefs(null)).toEqual(DEFAULT_VIDEO_PREFS);
  });

  it("une seule valeur abîmée ne fait pas perdre le reste", () => {
    const custom = structuredClone(DEFAULT_VIDEO_PREFS);
    custom.orientation = "9:16";
    custom.styles.translation.size = 1.5;
    custom.styles.translation.panel.kind = "blur";
    custom.layouts["1:1"].wave = { x: 0.1, y: 0.8, w: 0.8, h: 0.1 };
    const corrupt = structuredClone(custom) as unknown as {
      styles: { arabic: { panel: { kind: string }; size: number } };
      layouts: { "16:9": { arabic: { x: number } } };
    };
    corrupt.styles.arabic.panel.kind = "glass"; // valeur inconnue
    corrupt.layouts["16:9"].arabic.x = 5; // boîte hors cadre
    const fixed = sanitizeVideoPrefs(corrupt);
    // Les valeurs abîmées reprennent leur défaut…
    expect(fixed.styles.arabic.panel).toEqual(DEFAULT_STYLES.arabic.panel);
    expect(fixed.layouts["16:9"].arabic).toEqual(
      DEFAULT_LAYOUTS["16:9"].arabic,
    );
    // …tout le reste est gardé.
    expect(fixed.orientation).toBe("9:16");
    expect(fixed.styles.translation.size).toBe(1.5);
    expect(fixed.styles.translation.panel.kind).toBe("blur");
    expect(fixed.layouts["1:1"].wave).toEqual({
      x: 0.1,
      y: 0.8,
      w: 0.8,
      h: 0.1,
    });
  });

  it("des réglages valides sortent identiques", () => {
    expect(sanitizeVideoPrefs(DEFAULT_VIDEO_PREFS)).toEqual(
      DEFAULT_VIDEO_PREFS,
    );
  });

  it("migre aussi l'ancien format", () => {
    expect(sanitizeVideoPrefs(LEGACY_DEFAULTS)).toEqual(DEFAULT_VIDEO_PREFS);
  });
});

describe("layoutFor", () => {
  it("lit la mise en page de la forme du cadre", () => {
    expect(layoutFor(DEFAULT_VIDEO_PREFS, 1920, 1080)).toBe(
      DEFAULT_VIDEO_PREFS.layouts["16:9"],
    );
    expect(layoutFor(DEFAULT_VIDEO_PREFS, 1080, 1920)).toBe(
      DEFAULT_VIDEO_PREFS.layouts["9:16"],
    );
    expect(layoutFor(DEFAULT_VIDEO_PREFS, 1080, 1080)).toBe(
      DEFAULT_VIDEO_PREFS.layouts["1:1"],
    );
  });
});
