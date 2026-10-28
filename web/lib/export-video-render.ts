/**
 * Pilote de l'export vidéo animé, côté navigateur : prépare les entrées (résultat, crêtes,
 * fond), rend chaque frame sur canvas (mot courant surligné, onde jouée/non jouée), encode
 * en H.264 puis envoie les segments au serveur, qui muxe le MP4 avec la copie d'écoute.
 */
import { api } from "./api-client";
import {
  even,
  orientationSize,
  type VideoOrientation,
} from "./export-video-args";
import {
  h264Config,
  VideoEncoderUnavailableError,
  encodeFrames,
  newVideoJob,
} from "./export-video-codecs";
import {
  VIDEO_FPS,
  drawFrame,
  frameCards,
  frameCountFor,
  type FrameColors,
} from "./export-video-frames";
import { resolveOrientation, type VideoPrefs } from "./export-video-prefs";
import {
  chooseBackground,
  findBackground,
  DEFAULT_BACKGROUND_ID,
  type GradientBackground,
} from "./export-video-backgrounds";
import {
  isVideoExtension,
  loadBackground,
  loadFrameFonts,
  loadSourceVideo,
  videoSeeker,
  type LoadedBackground,
} from "./export-video-assets";
import type { ListeningPeaks } from "./listening";
import type { Recognition } from "./recognition";

type SessionInfo = {
  extension: string;
  name?: string;
};

export type RenderProgress = (message: string) => void;

/** Couleurs fixes de la vidéo (thème sombre lisible sur fond clair comme sombre). */
export const VIDEO_COLORS: FrameColors = {
  text: "#f5f1e8",
  accent: "#d8b45a",
  wave: "rgba(245, 241, 232, 0.32)",
  wavePlayed: "rgba(245, 241, 232, 0.92)",
};

export type RenderVideoInputs = {
  sessionId: string;
  prefs: VideoPrefs;
  bgImage: File | null;
  onProgress: RenderProgress;
};

/** Dimensions de la vidéo d'origine (métadonnées seulement), null si illisible. */
async function sourceVideoSize(
  background: LoadedBackground,
  sessionId: string,
): Promise<{ width: number; height: number } | null> {
  const video = background.video ?? (await loadSourceVideo(sessionId));
  if (!video) return null;
  const size = { width: video.videoWidth, height: video.videoHeight };
  if (!background.video) {
    video.removeAttribute("src");
    video.load();
  }
  return size;
}

/**
 * Rend la vidéo complète et déclenche le téléchargement du MP4.
 * Lève une erreur lisible (navigateur incompatible, encodage refusé…).
 */
export async function renderSessionVideo(
  inputs: RenderVideoInputs,
): Promise<void> {
  const { sessionId, prefs, bgImage, onProgress } = inputs;
  onProgress("Lecture du résultat…");
  const [detail, peaks] = await Promise.all([
    api<{
      session: SessionInfo & { state?: string };
      result: Recognition | null;
    }>(`/api/sessions/${sessionId}`),
    api<ListeningPeaks>(`/api/sessions/${sessionId}/peaks`),
  ]);
  const result = detail.result;
  if (!result) throw new Error("Aucun résultat à exporter.");
  const duration = peaks.duration;
  if (!(duration > 0))
    throw new Error("Copie d'écoute illisible : durée absente.");

  // Fond : image téléversée, sinon choix mémorisé, sinon vidéo d'origine / dégradé par défaut.
  onProgress("Préparation du fond…");
  const isVideo = isVideoExtension(detail.session.extension);
  const choice = chooseBackground(prefs.background, {
    hasUpload: bgImage !== null,
    isVideo,
  });
  const background = await loadBackground(choice, {
    upload: bgImage,
    sessionId,
    fallback: findBackground(DEFAULT_BACKGROUND_ID) as GradientBackground,
  });
  try {
    // Dimensions : orientation choisie ; « source » suit la vidéo d'origine.
    const sourceSize =
      prefs.orientation === "source" && isVideo
        ? await sourceVideoSize(background, sessionId)
        : null;
    const orientation: VideoOrientation = resolveOrientation(prefs, sourceSize);
    const base = orientationSize(orientation);
    const useSource = sourceSize !== null && prefs.orientation === "source";
    const width = even(useSource ? sourceSize.width : base.width);
    const height = even(useSource ? sourceSize.height : base.height);

    onProgress("Chargement des polices…");
    const verse = result.intervals.find((i) => i.kind === "verse" && !!i.text);
    const fonts = await loadFrameFonts(
      verse && verse.kind === "verse" ? (verse.text ?? "بسم الله") : "بسم الله",
    );

    const config = await h264Config(width, height, VIDEO_FPS);
    if (!config) throw new VideoEncoderUnavailableError();

    const cards = frameCards(result.intervals, prefs.showTranslation);
    if (cards.length === 0)
      throw new Error("Aucun passage coranique avec texte : rien à montrer.");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const measureContext = document.createElement("canvas").getContext("2d");
    if (!measureContext) throw new Error("Canvas 2D indisponible.");

    const seek = background.video
      ? videoSeeker(background.video, VIDEO_FPS)
      : null;
    const frameCount = frameCountFor(duration, VIDEO_FPS);
    const job = newVideoJob();

    onProgress(`Rendu des images (0 / ${frameCount})…`);
    const encoded = await encodeFrames({
      canvas,
      config,
      fps: VIDEO_FPS,
      frameCount,
      beforeFrame: seek
        ? async (index) => {
            await seek(index / VIDEO_FPS);
          }
        : undefined,
      draw: (ctx, index) => {
        const t = Math.min(index / VIDEO_FPS, duration - 0.001);
        drawFrame(ctx, {
          width,
          height,
          t,
          duration,
          cards,
          peaks,
          colors: VIDEO_COLORS,
          prefs,
          background: {
            color: prefs.bg,
            image: background.image,
            gradient: background.gradient,
          },
          scrim: background.scrim,
          measureContext,
          fontFamily: fonts.fontFamily,
          translationFontFamily: fonts.translationFontFamily,
        });
        if (index % 50 === 0)
          onProgress(`Rendu des images (${index} / ${frameCount})…`);
      },
    });

    await sendSegments(sessionId, job, encoded.segments, onProgress);
  } finally {
    background.close();
  }
}

/** Envoi des segments ; le dernier déclenche le mux et renvoie le MP4, téléchargé aussitôt. */
async function sendSegments(
  sessionId: string,
  job: string,
  segments: {
    index: number;
    last: boolean;
    data: Uint8Array;
  }[],
  onProgress: RenderProgress,
): Promise<void> {
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    onProgress(`Envoi des segments (${i + 1} / ${segments.length})…`);
    const response = await fetch(`/api/sessions/${sessionId}/export/video`, {
      method: "POST",
      headers: {
        "content-type": "video/h264",
        "x-aqr-job": job,
        "x-aqr-part": String(segment.index),
        "x-aqr-last": segment.last ? "1" : "0",
      },
      body: new Blob([segment.data.slice().buffer as ArrayBuffer], {
        type: "video/h264",
      }),
    });
    if (!response.ok) {
      let detailMessage = "Envoi vidéo impossible.";
      try {
        const record = (await response.json()) as { error?: string };
        if (record.error) detailMessage = record.error;
      } catch {
        /* corps illisible */
      }
      throw new Error(detailMessage);
    }
    if (!segment.last) continue;
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const name =
      /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? "video.mp4";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = decodeURIComponent(name);
    link.click();
    URL.revokeObjectURL(url);
    return;
  }
  throw new Error("La vidéo n'a pas été assemblée : segment final manquant.");
}
