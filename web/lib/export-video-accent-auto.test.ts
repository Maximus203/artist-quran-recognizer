import { describe, expect, it } from "vitest";
import { accentFromPixels, DEFAULT_ACCENT } from "./export-video-accent";
import {
  automaticAccent,
  videoColors,
  type LoadedBackground,
} from "./export-video-assets";
import { findBackground } from "./export-video-backgrounds";
import type { GradientBackground } from "./export-video-backgrounds";

/** Une image unie (48×48 RGBA) : l'accent attendu est celui de sa teinte. */
const solid = (r: number, g: number, b: number) => {
  const out = new Uint8ClampedArray(48 * 48 * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = 255;
  }
  return out;
};
const PINK = solid(230, 40, 120);

/**
 * Vidéo factice : tant qu'aucune image n'est décodée (readyState < 2), la lire donne des pixels
 * vides — exactement le cas qui donnait l'accent « or » à l'écran et « rose » côté serveur.
 */
function fakeVideo(initiallyReady: boolean) {
  const listeners = new Map<string, () => void>();
  const video = {
    readyState: initiallyReady ? 2 : 0,
    duration: 41.5,
    _t: 0,
    get currentTime() {
      return this._t;
    },
    set currentTime(value: number) {
      this._t = value;
      setTimeout(() => {
        video.readyState = 2;
        listeners.get("seeked")?.();
      }, 5);
    },
    addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  return video;
}
const pixelsOf = (source: unknown) =>
  (source as { readyState: number }).readyState >= 2
    ? PINK
    : new Uint8ClampedArray(48 * 48 * 4);

const videoBackground = (ready: boolean): LoadedBackground => {
  const video = fakeVideo(ready) as unknown as HTMLVideoElement;
  return {
    image: video,
    gradient: null,
    scrim: true,
    video,
    close: () => undefined,
  };
};

describe("accent automatique : une seule fonction, le même résultat partout", () => {
  it("vidéo pas encore décodée ou déjà prête : même accent (celui de l'image)", async () => {
    const expected = accentFromPixels(PINK);
    const cold = await automaticAccent(videoBackground(false), pixelsOf);
    const warm = await automaticAccent(videoBackground(true), pixelsOf);
    expect(cold).toEqual(expected);
    expect(warm).toEqual(expected);
    expect(cold).not.toEqual(DEFAULT_ACCENT);
  });
  it("dégradé : la teinte du dégradé ; aucun fond : l'accent par défaut", async () => {
    const gradient = findBackground("nuit-doree") as GradientBackground;
    expect(
      await automaticAccent({
        image: null,
        gradient,
        scrim: false,
        video: null,
        close: () => undefined,
      }),
    ).toEqual(gradient.accent);
    expect(
      await automaticAccent({
        image: null,
        gradient: null,
        scrim: false,
        video: null,
        close: () => undefined,
      }),
    ).toEqual(DEFAULT_ACCENT);
  });
  it("aperçu et rendu (écran comme API) passent par videoColors : couleurs identiques", async () => {
    const a = await videoColors(null, videoBackground(false), pixelsOf);
    const b = await videoColors(null, videoBackground(true), pixelsOf);
    expect(a).toEqual(b);
  });
  it("un accent choisi l'emporte toujours", async () => {
    const chosen = { h: 10, s: 50, l: 50, a: 1 };
    const colors = await videoColors(chosen, videoBackground(false), pixelsOf);
    expect(colors.accent).toContain("10");
  });
});
