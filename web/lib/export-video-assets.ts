/**
 * Ressources navigateur de la vidéo d'export (aperçu comme rendu final) : fond choisi
 * (image téléversée, photo proposée, vidéo d'origine, dégradé), polices, vidéo source.
 */
import {
  accentCss,
  accentFromPixels,
  DEFAULT_ACCENT,
  resolveAccent,
} from "./export-video-accent";
import type { FrameColors } from "./export-video-frames";
import type { AccentColor } from "./export-video-prefs";
import type {
  BackgroundChoice,
  GradientBackground,
} from "./export-video-backgrounds";

export type LoadedBackground = {
  image: CanvasImageSource | null;
  gradient: GradientBackground | null;
  /** Fond photo ou vidéo : le texte reçoit un support de lisibilité. */
  scrim: boolean;
  video: HTMLVideoElement | null;
  close: () => void;
};

/** Extensions de conteneurs vidéo (la piste image sert alors de fond). */
const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mkv",
  ".mov",
  ".avi",
  ".webm",
]);
export const isVideoExtension = (extension: string): boolean =>
  VIDEO_EXTENSIONS.has(extension.toLowerCase());

/** Charge la vidéo originale et attend ses métadonnées ; null si le navigateur ne la lit pas. */
export async function loadSourceVideo(
  sessionId: string,
): Promise<HTMLVideoElement | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = `/api/sessions/${sessionId}/video`;
  try {
    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadedmetadata", () => resolve(), { once: true });
      video.addEventListener("error", () => reject(new Error("vidéo")), {
        once: true,
      });
    });
    // Un MP4 ou un WebM peut ne contenir que du son : sans image, ce n'est pas un fond.
    return video.readyState >= 1 && video.duration > 0 && video.videoWidth > 0
      ? video
      : null;
  } catch {
    return null;
  }
}

/** Positionne la vidéo sur l'instant t (rendu hors ligne, image par image). */
export function videoSeeker(
  video: HTMLVideoElement,
  fps: number,
): (t: number) => Promise<void> {
  let at = -1;
  return async (t: number) => {
    if (Math.abs(at - t) < 1 / fps / 2) return;
    at = t;
    video.currentTime = Math.min(t, Math.max(0, video.duration - 0.04));
    await new Promise<void>((resolve) => {
      video.addEventListener("seeked", () => resolve(), { once: true });
    });
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Image de fond introuvable."));
    image.src = src;
  });
}

/** Charge le fond choisi. Un échec de chargement retombe sur le dégradé par défaut. */
export async function loadBackground(
  choice: BackgroundChoice,
  context: {
    upload: File | null;
    sessionId: string;
    fallback: GradientBackground;
  },
): Promise<LoadedBackground> {
  const none = (): LoadedBackground => ({
    image: null,
    gradient: context.fallback,
    scrim: false,
    video: null,
    close: () => undefined,
  });
  try {
    if (choice.kind === "upload" && context.upload) {
      const bitmap = await createImageBitmap(context.upload).catch(() => null);
      if (!bitmap) throw new Error("Image de fond illisible (PNG ou JPEG).");
      return {
        image: bitmap,
        gradient: null,
        scrim: true,
        video: null,
        close: () => bitmap.close(),
      };
    }
    if (choice.kind === "source") {
      const video = await loadSourceVideo(context.sessionId);
      if (!video) return none();
      return {
        image: video,
        gradient: null,
        scrim: true,
        video,
        close: () => {
          video.removeAttribute("src");
          video.load();
        },
      };
    }
    if (choice.kind === "preset") {
      if (choice.preset.kind === "gradient")
        return {
          image: null,
          gradient: choice.preset,
          scrim: false,
          video: null,
          close: () => undefined,
        };
      const image = await loadImage(choice.preset.src);
      return {
        image,
        gradient: null,
        scrim: true,
        video: null,
        close: () => undefined,
      };
    }
  } catch (error) {
    if (choice.kind === "upload") throw error;
  }
  return choice.kind === "color" ? { ...none(), gradient: null } : none();
}

export type FrameFonts = { fontFamily: string; translationFontFamily: string };

/** Polices du rendu : Mushaf pour l'arabe, police de l'interface pour la traduction. */
export async function loadFrameFonts(sample: string): Promise<FrameFonts> {
  const css = getComputedStyle(document.documentElement);
  const fontFamily = css.getPropertyValue("--font-quran").trim() || "serif";
  const translationFontFamily =
    css.getPropertyValue("--font-ui").trim() || "system-ui, sans-serif";
  await document.fonts
    .load(`72px ${fontFamily}`, sample)
    .catch(() => undefined);
  await document.fonts
    .load(`30px ${translationFontFamily}`, "Aa")
    .catch(() => undefined);
  await document.fonts.ready;
  return { fontFamily, translationFontFamily };
}

/** Couleur principale du fond chargé : teinte du dégradé, ou teinte dominante de l'image / de la vidéo. */
export function automaticAccent(background: LoadedBackground): AccentColor {
  if (background.gradient) return background.gradient.accent;
  const source = background.image;
  if (!source) return DEFAULT_ACCENT;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return DEFAULT_ACCENT;
    ctx.drawImage(source, 0, 0, 48, 48);
    return accentFromPixels(ctx.getImageData(0, 0, 48, 48).data);
  } catch {
    return DEFAULT_ACCENT;
  }
}

/** Couleurs de la vidéo : texte crème, accent choisi ou automatique, onde claire. */
export function videoColors(
  chosen: AccentColor | null,
  background: LoadedBackground,
): FrameColors {
  const accent = resolveAccent(chosen, automaticAccent(background));
  return {
    text: "#f5f1e8",
    accent: accentCss(accent),
    wave: "rgba(245, 241, 232, 0.32)",
    wavePlayed: "rgba(245, 241, 232, 0.92)",
  };
}
