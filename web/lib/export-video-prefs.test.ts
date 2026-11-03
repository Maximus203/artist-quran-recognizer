import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIDEO_PREFS,
  loadVideoPrefs,
  saveVideoPrefs,
  videoPrefsSchema,
  type VideoPrefs,
} from "./export-video-prefs";

const storageOf = (initial?: string) => {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set("aqr.ui.v1.export-video", initial);
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
};

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

describe("loadVideoPrefs / saveVideoPrefs", () => {
  it("retombe sur les défauts quand rien n'est mémorisé", () => {
    expect(loadVideoPrefs(storageOf())).toEqual(DEFAULT_VIDEO_PREFS);
  });

  it("retombe sur les défauts quand le contenu est illisible", () => {
    expect(loadVideoPrefs(storageOf("{pas du json"))).toEqual(
      DEFAULT_VIDEO_PREFS,
    );
    expect(loadVideoPrefs(storageOf('{"orientation":"9x16"}'))).toEqual(
      DEFAULT_VIDEO_PREFS,
    );
  });

  it("restitue ce qui a été mémorisé", () => {
    const storage = storageOf();
    const prefs: VideoPrefs = {
      ...DEFAULT_VIDEO_PREFS,
      orientation: "9:16",
      arabicSize: 96,
      translationSize: 40,
      showTranslation: false,
      bg: "#222222",
    };
    saveVideoPrefs(prefs, storage);
    expect(loadVideoPrefs(storage)).toEqual(prefs);
  });

  it("supporte un stockage absent (fenêtre privée)", () => {
    expect(loadVideoPrefs(null)).toEqual(DEFAULT_VIDEO_PREFS);
    expect(() => saveVideoPrefs(DEFAULT_VIDEO_PREFS, null)).not.toThrow();
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
