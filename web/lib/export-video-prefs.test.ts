import { describe, expect, it } from "vitest";
import { DEFAULT_VIDEO_PREFS, videoPrefsSchema } from "./export-video-prefs";

describe("videoPrefsSchema", () => {
  it("valide les valeurs par défaut", () => {
    expect(videoPrefsSchema.parse(DEFAULT_VIDEO_PREFS)).toEqual(
      DEFAULT_VIDEO_PREFS,
    );
  });

  it("affiche l'arabe quand le réglage mémorisé est antérieur à l'option", () => {
    const { showArabic: _omitted, ...previous } = DEFAULT_VIDEO_PREFS;
    expect(videoPrefsSchema.parse(previous).showArabic).toBe(true);
  });

  it("refuse une taille d'arabe hors bornes", () => {
    expect(
      videoPrefsSchema.safeParse({ ...DEFAULT_VIDEO_PREFS, arabicSize: 10 })
        .success,
    ).toBe(false);
  });

  it("refuse une orientation inconnue", () => {
    expect(
      videoPrefsSchema.safeParse({ ...DEFAULT_VIDEO_PREFS, orientation: "4:3" })
        .success,
    ).toBe(false);
  });
});

describe("nouveaux réglages (remplir, position, onde, accent)", () => {
  it("accepte d'anciens réglages sans ces champs et leur donne des défauts", () => {
    const old = {
      orientation: "16:9",
      arabicSize: 72,
      translationSize: 30,
      showTranslation: true,
      bg: "#101418",
    };
    const parsed = videoPrefsSchema.parse(old);
    expect(parsed).toMatchObject({
      fill: false,
      textPosition: 50,
      showWave: true,
      accent: null,
    });
  });

  it("refuse une position ou un accent hors bornes", () => {
    expect(
      videoPrefsSchema.safeParse({ ...DEFAULT_VIDEO_PREFS, textPosition: 120 })
        .success,
    ).toBe(false);
    expect(
      videoPrefsSchema.safeParse({
        ...DEFAULT_VIDEO_PREFS,
        accent: { h: 400, s: 50, l: 50, a: 1 },
      }).success,
    ).toBe(false);
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
