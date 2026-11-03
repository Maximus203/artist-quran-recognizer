import { describe, expect, it } from "vitest";
import { DEFAULT_VIDEO_PREFS, videoPrefsSchema } from "./export-video-prefs";

describe("videoPrefsSchema", () => {
  it("valide les valeurs par défaut", () => {
    expect(videoPrefsSchema.parse(DEFAULT_VIDEO_PREFS)).toEqual(
      DEFAULT_VIDEO_PREFS,
    );
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
