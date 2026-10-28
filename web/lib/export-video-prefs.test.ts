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
