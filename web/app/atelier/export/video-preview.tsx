"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { orientationSize } from "@/lib/export-video-args";
import {
  chooseBackground,
  DEFAULT_BACKGROUND_ID,
  findBackground,
  type GradientBackground,
} from "@/lib/export-video-backgrounds";
import {
  loadBackground,
  loadFrameFonts,
  videoColors,
  videoSeeker,
  type LoadedBackground,
} from "@/lib/export-video-assets";
import {
  drawFrame,
  frameCards,
  VIDEO_FPS,
  type FrameCard,
} from "@/lib/export-video-frames";
import { resolveOrientation, type VideoPrefs } from "@/lib/export-video-prefs";
import type { ListeningPeaks } from "@/lib/listening";
import type { Interval } from "@/lib/recognition";

/**
 * Aperçu fidèle du rendu : la vraie fonction de dessin de l'export, sur le verset le plus long
 * de la session (le pire cas) — on voit tout de suite si les écritures tiennent, avec le fond,
 * les tailles, la couleur et le format choisis. « Lire l'aperçu animé » joue quelques secondes
 * avec le son, image par image, comme la vidéo finale — sans rien encoder ni télécharger.
 */

const PREVIEW_LONG_SIDE = 640;
/** Durée de l'aperçu animé (s). */
export const PREVIEW_SECONDS = 10;

/** Le verset qui demande le plus de place, et un instant où un mot est surligné. */
export function worstCase(
  cards: readonly FrameCard[],
): { card: FrameCard; t: number } | null {
  let best: FrameCard | null = null;
  let bestScore = -1;
  for (const card of cards) {
    const score =
      card.card.arabic.length * 1.6 + (card.card.translation?.length ?? 0);
    if (score > bestScore) {
      best = card;
      bestScore = score;
    }
  }
  if (!best) return null;
  const times = best.live?.times;
  const middle =
    times && times.length ? times[Math.floor(times.length / 2)][0] : null;
  const t = middle ?? (best.card.start + best.card.end) / 2;
  return { card: best, t };
}

type PreviewInputs = {
  sessionId: string;
  intervals: readonly Interval[] | null;
  peaks: ListeningPeaks | null;
  prefs: VideoPrefs;
  upload: File | null;
  isVideo: boolean;
  sourceSize: { width: number; height: number } | null;
};

function previewSize(
  prefs: VideoPrefs,
  sourceSize: { width: number; height: number } | null,
) {
  const orientation = resolveOrientation(prefs, sourceSize);
  const full = orientationSize(orientation);
  const base = prefs.orientation === "source" && sourceSize ? sourceSize : full;
  const ratio = PREVIEW_LONG_SIDE / Math.max(base.width, base.height);
  return {
    width: Math.round(base.width * ratio),
    height: Math.round(base.height * ratio),
  };
}

async function loadResources(inputs: PreviewInputs, sample: string) {
  const choice = chooseBackground(inputs.prefs.background, {
    hasUpload: inputs.upload !== null,
    isVideo: inputs.isVideo,
  });
  const [fonts, background] = await Promise.all([
    loadFrameFonts(sample),
    loadBackground(choice, {
      upload: inputs.upload,
      sessionId: inputs.sessionId,
      fallback: findBackground(DEFAULT_BACKGROUND_ID) as GradientBackground,
    }),
  ]);
  return { fonts, background };
}

export function VideoPreview(inputs: PreviewInputs) {
  const { sessionId, intervals, peaks, prefs, upload, isVideo, sourceSize } =
    inputs;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);

  /** Image fixe : le verset le plus long avec les réglages courants. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !intervals || !peaks || playing) return;
    let cancelled = false;
    let close: (() => void) | undefined;
    (async () => {
      const cards = frameCards(intervals, prefs.showTranslation);
      const pick = worstCase(cards);
      const { width, height } = previewSize(prefs, sourceSize);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const measure = document.createElement("canvas").getContext("2d");
      if (!ctx || !measure) return;
      const { fonts, background } = await loadResources(
        inputs,
        pick?.card.card.arabic ?? "بسم الله",
      );
      close = background.close;
      if (cancelled) return;
      const t = pick?.t ?? 0;
      if (background.video) await videoSeeker(background.video, VIDEO_FPS)(t);
      if (cancelled) return;
      drawFrame(ctx, {
        width,
        height,
        t,
        duration: peaks.duration,
        cards,
        peaks,
        colors: videoColors(prefs.accent, background),
        prefs,
        background: {
          color: prefs.bg,
          image: background.image,
          gradient: background.gradient,
        },
        scrim: background.scrim,
        measureContext: measure,
        fontFamily: fonts.fontFamily,
        translationFontFamily: fonts.translationFontFamily,
      });
      setFailed(null);
    })().catch((error: unknown) => {
      if (!cancelled)
        setFailed(
          error instanceof Error ? error.message : "Aperçu indisponible.",
        );
    });
    return () => {
      cancelled = true;
      close?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    intervals,
    peaks,
    prefs,
    upload,
    isVideo,
    sourceSize,
    sessionId,
    playing,
  ]);

  const stop = useCallback(() => stopRef.current?.(), []);
  useEffect(() => () => stopRef.current?.(), []);

  /** Lecture animée : audio de la session + dessin à chaque image de l'écran. */
  const play = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !intervals || !peaks) return;
    setPlaying(true);
    let background: LoadedBackground | null = null;
    let audio: HTMLAudioElement | null = null;
    let frame = 0;
    const finish = () => {
      cancelAnimationFrame(frame);
      audio?.pause();
      background?.video?.pause();
      background?.close();
      stopRef.current = null;
      setPlaying(false);
    };
    stopRef.current = finish;
    try {
      const cards = frameCards(intervals, prefs.showTranslation);
      const pick = worstCase(cards);
      const { width, height } = previewSize(prefs, sourceSize);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const measure = document.createElement("canvas").getContext("2d");
      if (!ctx || !measure) return finish();
      const loaded = await loadResources(
        inputs,
        pick?.card.card.arabic ?? "بسم الله",
      );
      background = loaded.background;
      const colors = videoColors(prefs.accent, background);
      const start = Math.max(0, (pick?.card.card.start ?? 0) - 0.4);
      const end = Math.min(peaks.duration, start + PREVIEW_SECONDS);
      audio = new Audio(`/api/sessions/${sessionId}/audio`);
      audio.currentTime = start;
      if (background.video) {
        background.video.currentTime = start;
        void background.video.play().catch(() => undefined);
      }
      await audio.play();
      const tick = () => {
        if (!audio || !ctx) return;
        const t = audio.currentTime;
        drawFrame(ctx, {
          width,
          height,
          t,
          duration: peaks.duration,
          cards,
          peaks,
          colors,
          prefs,
          background: {
            color: prefs.bg,
            image: background?.image,
            gradient: background?.gradient,
          },
          scrim: background?.scrim ?? false,
          measureContext: measure,
          fontFamily: loaded.fonts.fontFamily,
          translationFontFamily: loaded.fonts.translationFontFamily,
        });
        if (t >= end || audio.ended) finish();
        else frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    } catch (error) {
      setFailed(
        error instanceof Error
          ? error.message
          : "Lecture de l'aperçu impossible.",
      );
      finish();
    }
  }, [intervals, peaks, prefs, sessionId, sourceSize, inputs]);

  return (
    <figure className="ex-video-preview">
      <canvas
        ref={canvasRef}
        className="ex-video-canvas"
        data-testid="video-preview"
        role="img"
        aria-label="Aperçu de la vidéo avec le verset le plus long de la session"
      />
      <div className="ex-video-preview-bar">
        <button
          type="button"
          className="btn btn--secondary"
          data-testid="video-preview-play"
          disabled={!intervals || !peaks}
          onClick={() => (playing ? stop() : void play())}
        >
          {playing
            ? "■ Arrêter l'aperçu"
            : `▶ Lire l'aperçu animé (${PREVIEW_SECONDS} s, avec le son)`}
        </button>
      </div>
      <figcaption className="ex-micro">
        {failed ??
          (intervals && peaks
            ? playing
              ? "Lecture : exactement le rendu de la vidéo finale."
              : "Aperçu : le verset le plus long de la session, tel qu'il sera dans la vidéo."
            : "Préparation de l'aperçu…")}
      </figcaption>
    </figure>
  );
}
