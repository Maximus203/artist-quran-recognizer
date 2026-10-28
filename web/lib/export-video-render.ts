/**
 * Pilote de l'export vidéo animé, côté navigateur : prépare les entrées (résultat, crêtes,
 * fond), rend chaque frame sur canvas (mot courant surligné, onde jouée/non jouée), encode
 * en H.264 puis envoie les segments au serveur, qui muxe le MP4 avec la copie d'écoute.
 */
import { api } from "./api-client";
import { even, type VideoOrientation } from "./export-video-args";
import { videoDimensions } from "./export-video-format";
import { videoRangeFileName, videoFileName } from "./export-video-name";
import { normalizeRanges, type NamedRange } from "./export-video-ranges";
import { fileProgressText, type FileProgress } from "./export-video-progress";
import {
  padRanges,
  suggestRanges,
  type SuggestGroup,
  type SuggestOptions,
} from "./export-video-suggest";
import {
  h264Config,
  VideoEncoderUnavailableError,
  encodeFrames,
  newVideoJob,
} from "./export-video-codecs";
import {
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
  videoColors,
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

/** Une vidéo produite (téléchargée dès qu'elle est prête). */
export type RenderedFile = { name: string; bytes: number };

/**
 * Échec pendant la vidéo `index` : les vidéos précédentes sont déjà téléchargées (`done`), rien
 * n'est perdu ; `memory` signale un manque de mémoire de l'encodeur (proposer une qualité plus basse).
 */
export class VideoFileError extends Error {
  constructor(
    message: string,
    readonly index: number,
    readonly done: RenderedFile[],
    readonly memory: boolean,
  ) {
    super(message);
    this.name = "VideoFileError";
  }
}

/** Erreur d'allocation ou d'encodeur : le navigateur a manqué de mémoire (souvent sur téléphone). */
export function looksLikeMemoryError(error: unknown): boolean {
  const text =
    error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /memory|allocation|quota|RangeError|EncodingError|out of/i.test(text);
}

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
  /** Nom du fichier téléchargé (avec .mp4) ; sinon celui de l'audio. */
  fileName?: string;
  /** Parties à exporter (une vidéo chacune, nom facultatif) ; absent = tout l'audio, une seule vidéo. */
  ranges?: NamedRange[];
  /** Une vidéo par verset reconnu (= `suggest: "verse"`, remplace `ranges`). */
  perVerse?: boolean;
  /** Découpe automatique protégée : un verset ou un passage par vidéo, avec marges et aimantation au silence. */
  suggest?: SuggestGroup;
  /** Marges (avant, après la récitation), aimantation au silence, écart de regroupement. */
  margins?: SuggestOptions;
  /** Élargit aussi les `ranges` donnés avec ces marges. */
  padRanges?: boolean;
  /** Annonce les vidéos qui vont être produites, avec leur nom de fichier (avant la première). */
  onCount?: (count: number, names: string[]) => void;
  /** Avancement structuré, fichier par fichier. */
  onFile?: (progress: FileProgress) => void;
  /** Lu entre deux vidéos : vrai = s'arrêter après la vidéo en cours (« Arrêter après cette vidéo »). */
  shouldStop?: () => boolean;
  onProgress: RenderProgress;
};

export type RenderOutcome = { files: RenderedFile[]; stopped: boolean };

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
 * Rend la ou les vidéos demandées et déclenche le téléchargement de chaque MP4 (une plage =
 * une vidéo, dans l'ordre). Lève une erreur lisible (navigateur incompatible, encodage refusé…).
 */
export async function renderSessionVideo(
  inputs: RenderVideoInputs,
): Promise<RenderOutcome> {
  const { sessionId, prefs, bgImage, onProgress, fileName } = inputs;
  const fps = prefs.fps;
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

  const cards = frameCards(result.intervals, prefs.showTranslation);
  if (cards.length === 0)
    throw new Error("Aucun passage coranique avec texte : rien à montrer.");
  const mode = inputs.suggest ?? (inputs.perVerse ? "verse" : undefined);
  const margins = inputs.margins ?? {};
  const requested: NamedRange[] | undefined = mode
    ? suggestRanges(result.intervals, duration, peaks, {
        ...margins,
        group: mode,
      }).map((r) => ({ start: r.start, end: r.end }))
    : inputs.padRanges && inputs.ranges && inputs.ranges.length > 0
      ? padRanges(inputs.ranges, result.intervals, duration, peaks, margins)
      : inputs.ranges;
  const plan = normalizeRanges(requested, duration);
  if (!plan.ok) throw new Error(plan.error);
  const ranges = plan.ranges;
  const whole = !requested || requested.length === 0;
  const names = ranges.map((range) =>
    whole
      ? fileName || videoFileName(detail.session.name ?? "video")
      : videoRangeFileName(
          detail.session.name ?? "video",
          fileName,
          range,
          ranges.length,
          range.name,
        ),
  );
  inputs.onCount?.(ranges.length, names);
  const files: RenderedFile[] = [];
  const report = (progress: FileProgress) => {
    inputs.onFile?.(progress);
    onProgress(fileProgressText(progress));
  };

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
    // Dimensions : format choisi à la résolution choisie ; « source » suit le cadre de la vidéo d'origine.
    const sourceSize =
      prefs.orientation === "source" && isVideo
        ? await sourceVideoSize(background, sessionId)
        : null;
    const orientation: VideoOrientation = resolveOrientation(prefs, sourceSize);
    const useSource = sourceSize !== null && prefs.orientation === "source";
    const size = videoDimensions(
      orientation,
      prefs.resolution,
      useSource ? sourceSize : null,
    );
    const width = even(size.width);
    const height = even(size.height);

    onProgress("Chargement des polices…");
    const verse = result.intervals.find((i) => i.kind === "verse" && !!i.text);
    const fonts = await loadFrameFonts(
      verse && verse.kind === "verse" ? (verse.text ?? "بسم الله") : "بسم الله",
    );

    if (typeof VideoEncoder === "undefined")
      throw new VideoEncoderUnavailableError();
    const config = await h264Config(width, height, fps);
    if (!config)
      throw new Error(
        `Ce navigateur ne sait pas encoder du ${width}×${height} à ${fps} images par seconde : choisis une résolution ou une cadence plus basse.`,
      );

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const measureContext = document.createElement("canvas").getContext("2d");
    if (!measureContext) throw new Error("Canvas 2D indisponible.");

    const colors = videoColors(prefs.accent, background);
    const seek = background.video ? videoSeeker(background.video, fps) : null;

    for (const [position, range] of ranges.entries()) {
      if (position > 0 && inputs.shouldStop?.())
        return { files, stopped: true };
      const total = ranges.length;
      const length = range.end - range.start;
      const frameCount = frameCountFor(length, fps);
      const job = newVideoJob();

      report({ index: position, total, phase: "render", ratio: 0 });
      try {
        const encoded = await encodeFrames({
          canvas,
          config,
          fps,
          frameCount,
          beforeFrame: seek
            ? async (index) => {
                await seek(
                  Math.min(range.start + index / fps, duration - 0.001),
                );
              }
            : undefined,
          draw: (ctx, index) => {
            const t = Math.min(range.start + index / fps, duration - 0.001);
            drawFrame(ctx, {
              width,
              height,
              t,
              duration,
              cards,
              peaks,
              colors,
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
              report({
                index: position,
                total,
                phase: "render",
                ratio: index / Math.max(1, frameCount),
              });
          },
        });

        const name = names[position];
        const bytes = await sendSegments(
          sessionId,
          job,
          encoded.segments,
          (ratio) => report({ index: position, total, phase: "send", ratio }),
          name,
          whole ? { fps } : { fps, start: range.start, duration: length },
        );
        files.push({ name, bytes });
        report({ index: position, total, phase: "done", ratio: 1, bytes });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Rendu impossible.";
        throw new VideoFileError(
          message,
          position,
          [...files],
          looksLikeMemoryError(error),
        );
      }
    }
    return { files, stopped: false };
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
  onSend: (ratio: number) => void,
  fileName: string,
  mux: { fps: number; start?: number; duration?: number },
): Promise<number> {
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    onSend(i / segments.length);
    const response = await fetch(`/api/sessions/${sessionId}/export/video`, {
      method: "POST",
      headers: {
        "content-type": "video/h264",
        "x-aqr-job": job,
        "x-aqr-part": String(segment.index),
        "x-aqr-last": segment.last ? "1" : "0",
        ...(segment.last
          ? {
              "x-aqr-fps": String(mux.fps),
              ...(mux.start !== undefined && mux.duration !== undefined
                ? {
                    "x-aqr-start": String(mux.start),
                    "x-aqr-duration": String(mux.duration),
                  }
                : {}),
            }
          : {}),
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
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    // Le navigateur lit l'URL au clic ; la libérer tout de suite peut annuler le téléchargement.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return blob.size;
  }
  throw new Error("La vidéo n'a pas été assemblée : segment final manquant.");
}
