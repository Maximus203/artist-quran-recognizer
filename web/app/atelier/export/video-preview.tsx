"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
  type FrameFonts,
  type LoadedBackground,
} from "@/lib/export-video-assets";
import {
  activeCardAt,
  cardLayoutFor,
  drawFrame,
  frameCards,
  VIDEO_FPS,
  type FrameCard,
  type FrameColors,
  type FrameState,
} from "@/lib/export-video-frames";
import type { CardLayout } from "@/lib/export-video-layout";
import { resolveOrientation, type VideoPrefs } from "@/lib/export-video-prefs";
import { backgroundVideoTimeAt } from "@/lib/export-video-vtime";
import type { ListeningPeaks } from "@/lib/listening";
import type { Interval } from "@/lib/recognition";

/**
 * Aperçu fidèle du rendu : la vraie fonction de dessin de l'export, sur le verset le plus long
 * de la session (le pire cas) — on voit tout de suite si les écritures tiennent, avec le fond,
 * les tailles, la couleur et le format choisis. « Lire l'aperçu animé » joue quelques secondes
 * avec le son, image par image, comme la vidéo finale — sans rien encoder ni télécharger.
 *
 * Le canevas occupe au mieux la place du parent, SANS jamais déformer le cadre, et `children` (le calque
 * d'édition) se pose par-dessus, exactement sur le canevas. Les réglages changent plusieurs fois par seconde
 * pendant un geste : les ressources (polices, fond) ne se rechargent que si le fond change, la couleur
 * d'accent que si l'accent change, et chaque dessin est regroupé sur l'image d'écran suivante.
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

/** L'instant de la vidéo à montrer : la vidéo d'origine suit la récitation, une vidéo de fond est calée par `vtime`. */
function backgroundTime(
  background: LoadedBackground,
  prefs: VideoPrefs,
  t: number,
  duration: number,
): number {
  return backgroundVideoTimeAt({
    clip: background.clip,
    t,
    rangeStart: 0,
    rangeLength: duration,
    videoDuration: background.video?.duration ?? 0,
    offset: prefs.backgroundVideo.offset,
    mode: prefs.backgroundVideo.mode,
  });
}

export type PreviewInputs = {
  sessionId: string;
  intervals: readonly Interval[] | null;
  peaks: ListeningPeaks | null;
  prefs: VideoPrefs;
  upload: File | null;
  /** Vidéo de fond choisie (muette) ; utilisée quand le fond choisi est « ma vidéo ». */
  clip?: File | null;
  isVideo: boolean;
  sourceSize: { width: number; height: number } | null;
  /** Instant montré (image fixe) : la position de la poignée ; absent = le verset le plus long. */
  at?: number | null;
  /** Légende sous l'image (sinon une phrase par défaut). */
  caption?: string;
  /** Posé par-dessus le canevas, exactement à sa taille (le calque d'édition). */
  children?: ReactNode;
  /** Dit la mise en page de la carte montrée (réductions du texte à sa zone) après chaque dessin. */
  onLayout?: (layout: CardLayout | null) => void;
  /** Dit si l'aperçu animé joue (le calque se met en retrait pendant la lecture). */
  onPlayingChange?: (playing: boolean) => void;
};

/** Dimensions du canevas : le cadre choisi, à la taille de l'aperçu (côté long de 640 px). */
export function previewSize(
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

type Resources = {
  fonts: FrameFonts;
  background: LoadedBackground;
  seek: ((t: number) => Promise<void>) | null;
};

/** Polices et fond : ce qui se charge, donc ce qu'un geste ne doit jamais recharger. */
async function loadResources(
  inputs: Pick<PreviewInputs, "upload" | "clip" | "isVideo" | "sessionId"> & {
    background: string | null;
  },
  sample: string,
): Promise<Resources> {
  const choice = chooseBackground(inputs.background, {
    hasUpload: inputs.upload !== null,
    hasVideoUpload: !!inputs.clip,
    isVideo: inputs.isVideo,
  });
  const [fonts, background] = await Promise.all([
    loadFrameFonts(sample),
    loadBackground(choice, {
      upload: inputs.upload,
      clip: inputs.clip ?? null,
      sessionId: inputs.sessionId,
      fallback: findBackground(DEFAULT_BACKGROUND_ID) as GradientBackground,
    }),
  ]);
  return {
    fonts,
    background,
    seek: background.video ? videoSeeker(background.video, VIDEO_FPS) : null,
  };
}

/** Un échantillon d'écriture pour charger la police avant de dessiner (jamais affiché : seulement mesuré). */
const FALLBACK_SAMPLE = "بسم الله";

/** La taille du plus grand rectangle de rapport `ratio` qui tient dans `host` (moins `pad` de chaque côté). */
function useFitSize(
  host: React.RefObject<HTMLElement | null>,
  ratio: number,
): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const measure = () => {
      const style = getComputedStyle(node);
      const availW =
        node.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight);
      const availH =
        node.clientHeight -
        parseFloat(style.paddingTop) -
        parseFloat(style.paddingBottom);
      if (availW < 20 || availH < 20) return;
      const width = Math.min(availW, availH * ratio);
      const next = {
        width: Math.floor(width),
        height: Math.floor(width / ratio),
      };
      setSize((old) =>
        old && old.width === next.width && old.height === next.height
          ? old
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [host, ratio]);
  return size;
}

export function VideoPreview(inputs: PreviewInputs) {
  const {
    sessionId,
    intervals,
    peaks,
    prefs,
    upload,
    isVideo,
    sourceSize,
    onLayout,
    onPlayingChange,
  } = inputs;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [resources, setResources] = useState<Resources | null>(null);
  const [colors, setColors] = useState<FrameColors | null>(null);
  const measureRef = useRef<CanvasRenderingContext2D | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const layoutCallback = useRef(onLayout);
  layoutCallback.current = onLayout;
  const playingCallback = useRef(onPlayingChange);
  playingCallback.current = onPlayingChange;

  // Les cartes ne dépendent que du résultat et des écritures affichées : pas du glisser.
  const cards = useMemo(
    () =>
      intervals
        ? frameCards(intervals, prefs.showTranslation, prefs.showArabic)
        : [],
    [intervals, prefs.showTranslation, prefs.showArabic],
  );
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const pick = useMemo(() => worstCase(cards), [cards]);
  const size = useMemo(
    () => previewSize(prefs, sourceSize),
    [prefs, sourceSize],
  );
  const fitted = useFitSize(hostRef, size.width / size.height);

  // Polices et fond : seulement quand le fond change, jamais pendant un geste ni au masquage d'un texte.
  const background = prefs.background;
  const clip = inputs.clip ?? null;
  const sample = useMemo(
    () =>
      (intervals
        ? worstCase(frameCards(intervals, true, true))?.card.card.arabic
        : null) ?? FALLBACK_SAMPLE,
    [intervals],
  );
  const ready = Boolean(intervals && peaks);
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let loaded: Resources | null = null;
    loadResources({ background, upload, clip, isVideo, sessionId }, sample)
      .then((next) => {
        if (cancelled) return next.background.close();
        loaded = next;
        setResources(next);
        setFailed(null);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setFailed(
            error instanceof Error ? error.message : "Aperçu indisponible.",
          );
      });
    return () => {
      cancelled = true;
      loaded?.background.close();
      setResources((current) => (current === loaded ? null : current));
    };
  }, [ready, sample, upload, clip, isVideo, sessionId, background]);

  // Couleur d'accent : propre à l'accent choisi et au fond chargé (une vidéo est lue à `ACCENT_SAMPLE_S`
  // AVANT de se placer à t) ; changer l'accent ne recharge pas le fond.
  const accent = prefs.accent;
  useEffect(() => {
    if (!resources) return;
    let cancelled = false;
    void videoColors(accent, resources.background).then((next) => {
      if (!cancelled) setColors(next);
    });
    return () => {
      cancelled = true;
    };
  }, [resources, accent]);

  const draw = useCallback(
    async (state: { t: number; cancelled: () => boolean }) => {
      const canvas = canvasRef.current;
      if (!canvas || !peaks || !resources || !colors) return;
      const current = prefsRef.current;
      const { width, height } = previewSize(current, sourceSize);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const ctx = canvas.getContext("2d");
      const measure = (measureRef.current ??= document
        .createElement("canvas")
        .getContext("2d"));
      if (!ctx || !measure) return;
      if (resources.seek && resources.background.video)
        await resources.seek(
          backgroundTime(
            resources.background,
            current,
            state.t,
            peaks.duration,
          ),
        );
      if (state.cancelled()) return;
      const frame: FrameState = {
        width,
        height,
        t: state.t,
        duration: peaks.duration,
        cards: cardsRef.current,
        peaks,
        colors,
        prefs: current,
        background: {
          color: current.bg,
          image: resources.background.image,
          gradient: resources.background.gradient,
        },
        scrim: resources.background.scrim,
        measureContext: measure,
        fontFamily: resources.fonts.fontFamily,
        translationFontFamily: resources.fonts.translationFontFamily,
      };
      drawFrame(ctx, frame);
      const active = activeCardAt(frame.cards, state.t);
      layoutCallback.current?.(active ? cardLayoutFor(frame, active) : null);
    },
    [peaks, resources, colors, sourceSize],
  );

  /** Image fixe : le verset le plus long avec les réglages courants, regroupée sur l'image d'écran suivante. */
  useEffect(() => {
    if (playing || !resources) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      void draw({
        t: inputs.at ?? pick?.t ?? 0,
        cancelled: () => cancelled,
      }).catch((error: unknown) => {
        if (!cancelled)
          setFailed(
            error instanceof Error ? error.message : "Aperçu indisponible.",
          );
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [draw, playing, resources, colors, pick, inputs.at, prefs, fitted]);

  const stop = useCallback(() => stopRef.current?.(), []);
  useEffect(() => () => stopRef.current?.(), []);
  useEffect(() => {
    playingCallback.current?.(playing);
  }, [playing]);

  /** Lecture animée : audio de la session + dessin à chaque image de l'écran, avec les réglages du moment. */
  const play = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !intervals || !peaks || !resources || !colors) return;
    setPlaying(true);
    const background = resources.background;
    let audio: HTMLAudioElement | null = null;
    let frame = 0;
    let stopped = false;
    const finish = () => {
      stopped = true;
      cancelAnimationFrame(frame);
      audio?.pause();
      background.video?.pause();
      stopRef.current = null;
      setPlaying(false);
    };
    stopRef.current = finish;
    try {
      const start = Math.max(0, (pick?.card.card.start ?? 0) - 0.4);
      const end = Math.min(peaks.duration, start + PREVIEW_SECONDS);
      audio = new Audio(`/api/sessions/${sessionId}/audio`);
      audio.currentTime = start;
      if (background.video) {
        background.video.currentTime = backgroundTime(
          background,
          prefsRef.current,
          start,
          peaks.duration,
        );
        void background.video.play().catch(() => undefined);
      }
      await audio.play();
      const tick = () => {
        if (!audio || stopped) return;
        const t = audio.currentTime;
        // Une vidéo de fond suit `vtime` (boucle, portion…) : on la recale quand elle s'en écarte.
        if (background.clip && background.video) {
          const want = backgroundTime(
            background,
            prefsRef.current,
            t,
            peaks.duration,
          );
          if (Math.abs(background.video.currentTime - want) > 0.3)
            background.video.currentTime = want;
        }
        // Pendant la lecture la vidéo avance seule : on dessine sans la repositionner.
        const ctx = canvas.getContext("2d");
        const measure = (measureRef.current ??= document
          .createElement("canvas")
          .getContext("2d"));
        if (ctx && measure) {
          const current = prefsRef.current;
          const { width, height } = previewSize(current, sourceSize);
          if (canvas.width !== width || canvas.height !== height) {
            canvas.width = width;
            canvas.height = height;
          }
          drawFrame(ctx, {
            width,
            height,
            t,
            duration: peaks.duration,
            cards: cardsRef.current,
            peaks,
            colors,
            prefs: current,
            background: {
              color: current.bg,
              image: background.image,
              gradient: background.gradient,
            },
            scrim: background.scrim,
            measureContext: measure,
            fontFamily: resources.fonts.fontFamily,
            translationFontFamily: resources.fonts.translationFontFamily,
          });
        }
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
  }, [intervals, peaks, resources, colors, pick, sessionId, sourceSize]);

  // Légende lue par les lecteurs d'écran : ce que montre l'image (le texte vient toujours du corpus).
  const caption =
    failed ??
    inputs.caption ??
    (intervals && peaks
      ? playing
        ? "Lecture : exactement le rendu de la vidéo finale."
        : "Aperçu : le verset le plus long de la session, tel qu'il sera dans la vidéo."
      : "Préparation de l'aperçu…");

  return (
    <figure className="xe-figure">
      <div ref={hostRef} className="xe-stage-host">
        <div
          className="xe-stage"
          data-testid="video-stage"
          style={{
            aspectRatio: `${size.width} / ${size.height}`,
            ...(fitted ? { width: fitted.width, height: fitted.height } : {}),
          }}
        >
          <canvas
            ref={canvasRef}
            className="ex-video-canvas"
            data-testid="video-preview"
            role="img"
            aria-label="Aperçu de la vidéo avec le verset le plus long de la session"
          />
          {inputs.children}
        </div>
      </div>
      <div className="xe-transport">
        <button
          type="button"
          className="xe-play"
          data-testid="video-preview-play"
          disabled={!intervals || !peaks || !resources || !colors}
          aria-label={
            playing
              ? "Arrêter l'aperçu animé"
              : `Lire l'aperçu animé : ${PREVIEW_SECONDS} secondes, avec le son`
          }
          onClick={() => (playing ? stop() : void play())}
        >
          <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
            {playing ? (
              <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />
            ) : (
              <path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" />
            )}
          </svg>
        </button>
        <span
          className="xe-caption"
          data-failed={failed ? "" : undefined}
          role={failed ? "alert" : undefined}
        >
          {failed ??
            (playing
              ? "Lecture de l’aperçu, avec le son"
              : `Aperçu animé : ${PREVIEW_SECONDS} secondes de la récitation`)}
        </span>
      </div>
      <figcaption className="sr">{caption}</figcaption>
    </figure>
  );
}
