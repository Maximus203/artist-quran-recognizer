"use client";
import { useEffect, useRef, useState } from "react";
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
  videoSeeker,
} from "@/lib/export-video-assets";
import {
  drawFrame,
  frameCards,
  VIDEO_FPS,
  type FrameCard,
} from "@/lib/export-video-frames";
import { resolveOrientation, type VideoPrefs } from "@/lib/export-video-prefs";
import { VIDEO_COLORS } from "@/lib/export-video-render";
import type { ListeningPeaks } from "@/lib/listening";
import type { Interval } from "@/lib/recognition";

/**
 * Aperçu fidèle du rendu : la vraie fonction de dessin de l'export, sur le verset le plus long
 * de la session (le pire cas) — on voit tout de suite si les écritures tiennent, avec le fond,
 * les tailles et le format choisis.
 */

const PREVIEW_LONG_SIDE = 640;

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

export function VideoPreview({
  sessionId,
  intervals,
  peaks,
  prefs,
  upload,
  isVideo,
  sourceSize,
}: {
  sessionId: string;
  intervals: readonly Interval[] | null;
  peaks: ListeningPeaks | null;
  prefs: VideoPrefs;
  upload: File | null;
  isVideo: boolean;
  sourceSize: { width: number; height: number } | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !intervals || !peaks) return;
    let cancelled = false;
    let close: (() => void) | undefined;
    (async () => {
      const cards = frameCards(intervals, prefs.showTranslation);
      const pick = worstCase(cards);
      const orientation = resolveOrientation(prefs, sourceSize);
      const full = orientationSize(orientation);
      const sizeBase =
        prefs.orientation === "source" && sourceSize ? sourceSize : full;
      const ratio =
        PREVIEW_LONG_SIDE / Math.max(sizeBase.width, sizeBase.height);
      const width = Math.round(sizeBase.width * ratio);
      const height = Math.round(sizeBase.height * ratio);
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      const measure = document.createElement("canvas").getContext("2d");
      if (!ctx || !measure) return;
      const choice = chooseBackground(prefs.background, {
        hasUpload: upload !== null,
        isVideo,
      });
      const [fonts, background] = await Promise.all([
        loadFrameFonts(pick?.card.card.arabic ?? "بسم الله"),
        loadBackground(choice, {
          upload,
          sessionId,
          fallback: findBackground(DEFAULT_BACKGROUND_ID) as GradientBackground,
        }),
      ]);
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
        colors: VIDEO_COLORS,
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
  }, [intervals, peaks, prefs, upload, isVideo, sourceSize, sessionId]);

  return (
    <figure className="ex-video-preview">
      <canvas
        ref={canvasRef}
        className="ex-video-canvas"
        data-testid="video-preview"
        role="img"
        aria-label="Aperçu de la vidéo avec le verset le plus long de la session"
      />
      <figcaption className="ex-micro">
        {failed ??
          (intervals && peaks
            ? "Aperçu : le verset le plus long de la session, tel qu'il sera dans la vidéo."
            : "Préparation de l'aperçu…")}
      </figcaption>
    </figure>
  );
}
