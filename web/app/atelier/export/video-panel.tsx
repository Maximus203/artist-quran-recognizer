"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { isVideoExtension, loadSourceVideo } from "@/lib/export-video-assets";
import {
  chooseBackground,
  SOURCE_BACKGROUND_ID,
} from "@/lib/export-video-backgrounds";
import { videoCardInputs } from "@/lib/export-video-cards";
import { EXPORT_VIDEO_CONFIG } from "@/lib/export-video-config";
import { videoDimensions } from "@/lib/export-video-format";
import { videoFileName, videoRangeFileName } from "@/lib/export-video-name";
import {
  addVerse,
  fromSuggestions,
  isWhole,
  moveDown,
  moveUp,
  reflow,
  removeRange,
  snapTargets,
  suggestionNear,
  suggestions as suggestionsOf,
  totalSeconds,
  wholeAudio,
  type PlanContext,
  type PlanRange,
} from "@/lib/export-video-plan";
import {
  DEFAULT_VIDEO_PREFS,
  loadVideoPrefs,
  resolveOrientation,
  saveVideoPrefs,
  type VideoPrefs,
} from "@/lib/export-video-prefs";
import {
  applyFileProgress,
  failFile,
  initialFiles,
  type FileRow,
} from "@/lib/export-video-progress";
import {
  downloadBlob,
  renderSessionVideo,
  VideoFileError,
  type RenderedFile,
} from "@/lib/export-video-render";
import { exportVideoRequest } from "@/lib/export-video-request";
import { findSilences } from "@/lib/export-video-suggest";
import {
  megabytesFr,
  rangesWeight,
  renderTimeFr,
  weightLevel,
} from "@/lib/export-video-weight";
import { fitView, formatClock, type View } from "@/lib/export-timeline";
import { formatDurationFr } from "@/lib/format";
import type { ListeningPeaks } from "@/lib/listening";
import type { Interval, Recognition } from "@/lib/recognition";
import { useMedia, useStoreValue } from "../hooks";
import type { usePlayer } from "../use-player";
import { XIcon } from "./export-icons";
import { Chapter } from "./export-ui";
import { BreathSettings, RangeList } from "./range-list";
import { RangeTimeline, type Thumbs } from "./range-timeline";
import {
  Bordereau,
  ExportDock,
  ExportSheet,
  type BordereauProps,
  type ExportFailure,
  type ExportPhase,
} from "./video-bordereau";
import { backgroundName, formatName, sizeName, VideoLook } from "./video-look";
import { VideoPreview } from "./video-preview";
import { CustomQuality, QualityTiers, WeightGauge } from "./video-quality";

/**
 * Onglet « Vidéo » de l'export, direction « Le rouleau et les signets » : 1. ce que tu exportes
 * (frise + plages + souffle), 2. à quoi elle ressemble, 3. qualité et poids ; l'aperçu et le
 * bordereau restent visibles (colonne collante au bureau, bandeau + dock sur téléphone). Les
 * réglages se mémorisent (`aqr.ui.v1.export-video`).
 */
type Player = ReturnType<typeof usePlayer>;
const TL = EXPORT_VIDEO_CONFIG.timeline;
const THUMBS = EXPORT_VIDEO_CONFIG.thumbnails;

export function VideoPanel({
  sessionId,
  player,
  onError,
  onGoVerify,
  announce,
}: {
  sessionId: string;
  player: Player;
  onError: (message: string) => void;
  onGoVerify: () => void;
  announce: (message: string) => void;
}) {
  const wide = useMedia("(min-width: 1024px)");
  const [prefs, setPrefs] = useState<VideoPrefs>(DEFAULT_VIDEO_PREFS);
  const [prefsReady, setPrefsReady] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [intervals, setIntervals] = useState<readonly Interval[] | null>(null);
  const [peaks, setPeaks] = useState<ListeningPeaks | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isVideo, setIsVideo] = useState(false);
  const [videoCandidate, setVideoCandidate] = useState(false);
  const [videoChecked, setVideoChecked] = useState(false);
  const [sourceSize, setSourceSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [thumbs, setThumbs] = useState<Thumbs | null>(null);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [bgThumb, setBgThumb] = useState<string | null>(null);
  const [ranges, setRanges] = useState<PlanRange[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [view, setView] = useState<View>({ a: 0, b: 1 });
  const [previewAt, setPreviewAt] = useState<number | null>(null);
  const [open, setOpen] = useState({ what: true, look: true, quality: true });
  const [phase, setPhase] = useState<"idle" | "render" | "done" | "error">(
    "idle",
  );
  const [files, setFiles] = useState<FileRow[]>([]);
  const [failure, setFailure] = useState<ExportFailure | null>(null);
  const [stopRequested, setStopRequested] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [miniShown, setMiniShown] = useState(false);
  const nextId = useRef(1);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const stopRef = useRef(false);
  const blobs = useRef<(RenderedFile | null)[]>([]);
  const thumbUrl = useRef<string | null>(null);
  const stageWrap = useRef<HTMLDivElement>(null);
  const playing = useStoreValue(player.store, (s) => s.playing);
  const [playingRange, setPlayingRange] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) setPlayingRange(null);
  }, [playing]);

  // --- données : résultat, crêtes, vidéo d'origine, imagettes ------------------------------
  useEffect(() => {
    setPrefs(loadVideoPrefs());
    setPrefsReady(true);
    let cancelled = false;
    Promise.all([
      api<{
        session: { extension?: string; name?: string };
        result: Recognition | null;
      }>(`/api/sessions/${sessionId}`),
      api<ListeningPeaks>(`/api/sessions/${sessionId}/peaks`).catch(() => null),
    ])
      .then(([data, peakData]) => {
        if (cancelled) return;
        const candidate = isVideoExtension(data.session.extension ?? "");
        setVideoCandidate(candidate);
        setSessionName(data.session.name ?? "");
        setIntervals(data.result?.intervals ?? []);
        setPeaks(peakData);
        if (!peakData) setLoadFailed(true);
        if (candidate)
          void loadSourceVideo(sessionId).then((element) => {
            if (cancelled) return;
            setVideoChecked(true);
            if (!element) return;
            setIsVideo(true);
            setSourceSize({
              width: element.videoWidth,
              height: element.videoHeight,
            });
            element.removeAttribute("src");
            element.load();
          });
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const duration = peaks?.duration ?? 0;
  useEffect(() => {
    if (!isVideo || !duration) return;
    let cancelled = false;
    const count = THUMBS.defaultCount;
    fetch(
      `/api/sessions/${sessionId}/thumbnails?count=${count}&width=${THUMBS.defaultWidth}`,
    )
      .then((r) => (r.ok ? r.blob() : null))
      .then((blob) => {
        if (!blob || cancelled) return;
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
          if (!cancelled) setThumbs({ image, count, every: duration / count });
        };
        image.src = url;
      })
      .catch(() => undefined); // sans imagettes, la frise reste complète
    return () => {
      cancelled = true;
    };
  }, [isVideo, duration, sessionId]);

  const patch = useCallback((next: Partial<VideoPrefs>) => {
    setPrefs((current) => {
      const value = { ...current, ...next };
      saveVideoPrefs(value);
      return value;
    });
  }, []);

  const ctx: PlanContext | null = useMemo(
    () =>
      intervals && peaks
        ? {
            intervals,
            duration: peaks.duration,
            peaks,
            padding: {
              before: prefs.paddingBefore,
              after: prefs.paddingAfter,
              snap: prefs.snapToSilence,
            },
          }
        : null,
    [
      intervals,
      peaks,
      prefs.paddingBefore,
      prefs.paddingAfter,
      prefs.snapToSilence,
    ],
  );
  const proposed = useMemo(() => (ctx ? suggestionsOf(ctx) : []), [ctx]);
  const targets = useMemo(() => (ctx ? snapTargets(ctx) : []), [ctx]);
  const silences = useMemo(
    () => (peaks ? findSilences(peaks, intervals ?? []) : []),
    [peaks, intervals],
  );
  const cardCount = useMemo(
    () => (intervals ? videoCardInputs(intervals).length : null),
    [intervals],
  );

  // Première composition : tout l'audio (comme avant la refonte), vue d'ensemble complète.
  const started = useRef(false);
  useEffect(() => {
    if (!ctx || started.current) return;
    started.current = true;
    const first = wholeAudio(ctx, nextId.current++);
    setRanges([first]);
    setSelectedId(first.id);
    setView({ a: 0, b: ctx.duration });
  }, [ctx]);
  // Les plages automatiques suivent le souffle.
  useEffect(() => {
    if (ctx && started.current) setRanges((current) => reflow(current, ctx));
  }, [ctx]);

  const selected = ranges.find((r) => r.id === selectedId) ?? null;
  const selectedIndex = selected ? ranges.indexOf(selected) : -1;
  const select = useCallback(
    (id: number) => {
      setSelectedId(id);
      const range = ranges.find((r) => r.id === id);
      if (range && ctx) {
        setPreviewAt(
          Math.min(range.end, range.start + prefs.paddingBefore + 0.5),
        );
        if (range.end < view.a || range.start > view.b)
          setView(fitView(range, ctx.duration, TL.minSpanSeconds));
      }
    },
    [ranges, ctx, prefs.paddingBefore, view],
  );

  // --- raccourcis et liste -------------------------------------------------------------------
  const allAudio = () => {
    if (!ctx) return;
    const r = wholeAudio(ctx, nextId.current++);
    setRanges([r]);
    setSelectedId(r.id);
    setView({ a: 0, b: ctx.duration });
    announce("Une seule vidéo : tout l’audio.");
  };
  const perVerse = () => {
    if (!ctx) return;
    const list = fromSuggestions(ctx, nextId.current);
    nextId.current += list.length;
    if (list.length === 0) return;
    setRanges(list);
    setSelectedId(list[0].id);
    setPreviewAt(
      Math.min(list[0].end, list[0].start + prefs.paddingBefore + 0.5),
    );
    setView(fitView(list[0], ctx.duration, TL.minSpanSeconds));
    announce(
      `${list.length} plages : une vidéo par passage reconnu, souffle compris.`,
    );
  };
  const addAt = (t: number) => {
    if (!ctx) return;
    const id = nextId.current++;
    const next = addVerse(ranges, ctx, t, id);
    if (next === ranges) {
      announce(
        ranges.length >= 50
          ? "Liste pleine : 50 plages au plus."
          : "Aucun passage à proposer ici.",
      );
      return;
    }
    // « Tout l'audio » laisse sa place quand on commence à choisir des passages.
    const cleaned =
      ranges.length === 1 && isWhole(ranges[0], ctx.duration)
        ? next.slice(1)
        : next;
    setRanges(cleaned);
    setSelectedId(id);
    const added = cleaned[cleaned.length - 1];
    setPreviewAt(added.start + prefs.paddingBefore);
    if (added.end < view.a || added.start > view.b)
      setView(fitView(added, ctx.duration, TL.minSpanSeconds));
    announce(
      `Plage ajoutée : ${added.name || "passage"}, ${formatDurationFr(added.end - added.start)}.`,
    );
  };
  const addNearCenter = () => {
    if (!ctx) return;
    const s = suggestionNear(ctx, (view.a + view.b) / 2, ranges);
    if (s) addAt((s.core_start + s.core_end) / 2);
    else announce("Tous les passages proposés sont déjà dans la liste.");
  };
  const changeRange = useCallback(
    (id: number, next: { start: number; end: number }) => {
      setRanges((list) =>
        list.map((r) => (r.id === id ? { ...r, ...next, auto: false } : r)),
      );
    },
    [],
  );
  const remove = (id: number) => {
    const i = ranges.findIndex((r) => r.id === id);
    const gone = ranges[i];
    const next = removeRange(ranges, id);
    setRanges(next);
    setSelectedId(next[Math.min(i, next.length - 1)]?.id ?? null);
    announce(`Plage ${i + 1}${gone?.name ? ` « ${gone.name} »` : ""} retirée.`);
  };

  const togglePlay = () => {
    if (playing) {
      player.toggle();
      return;
    }
    if (!selected) return;
    if (ctx && (selected.start < view.a || selected.end > view.b))
      setView(fitView(selected, ctx.duration, TL.minSpanSeconds));
    setPlayingRange(selected.id);
    player.playRange(selected.start, selected.end, {
      onDone: () => setPlayingRange(null),
    });
  };

  // --- fond -----------------------------------------------------------------------------------
  const pickUpload = useCallback((file: File | null) => {
    if (thumbUrl.current) URL.revokeObjectURL(thumbUrl.current);
    setBgFile(file);
    thumbUrl.current = file ? URL.createObjectURL(file) : null;
    setBgThumb(thumbUrl.current);
  }, []);
  useEffect(
    () => () => {
      if (thumbUrl.current) URL.revokeObjectURL(thumbUrl.current);
    },
    [],
  );
  const choice = chooseBackground(prefs.background, {
    hasUpload: bgFile !== null,
    isVideo,
  });
  const selectedBg =
    choice.kind === "upload"
      ? "upload"
      : choice.kind === "source"
        ? SOURCE_BACKGROUND_ID
        : choice.kind === "color"
          ? "color"
          : choice.preset.id;

  // --- poids, bordereau, API ------------------------------------------------------------------
  const whole = ranges.length === 1 && isWhole(ranges[0], duration);
  const frameSize = useMemo(() => {
    const orientation = resolveOrientation(prefs, sourceSize);
    const useSource = prefs.orientation === "source" && sourceSize !== null;
    return videoDimensions(
      orientation,
      prefs.resolution,
      useSource ? sourceSize : null,
    );
  }, [prefs, sourceSize]);
  const sizeFor = useCallback(
    (resolution: number) => {
      const orientation = resolveOrientation(prefs, sourceSize);
      const useSource = prefs.orientation === "source" && sourceSize !== null;
      return videoDimensions(
        orientation,
        resolution,
        useSource ? sourceSize : null,
      );
    },
    [prefs, sourceSize],
  );
  const durations = useMemo(() => ranges.map((r) => r.end - r.start), [ranges]);
  const weightFor = useCallback(
    (resolution: number, fps: number) =>
      rangesWeight(sizeFor(resolution), fps, durations),
    [sizeFor, durations],
  );
  const weight = weightFor(prefs.resolution, prefs.fps);
  const level = weightLevel(weight, prefs);
  const seconds = totalSeconds(ranges);
  const fileNames = useMemo(
    () =>
      ranges.map((r) =>
        whole
          ? videoFileName(sessionName)
          : videoRangeFileName(
              sessionName,
              undefined,
              r,
              ranges.length,
              r.name,
            ),
      ),
    [ranges, whole, sessionName],
  );
  const apiJson = useMemo(
    () =>
      JSON.stringify(
        { id: sessionId, ...exportVideoRequest(prefs, ranges, duration) },
        null,
        2,
      ),
    [sessionId, prefs, ranges, duration],
  );

  // --- export ---------------------------------------------------------------------------------
  const run = useCallback(
    async (subset: PlanRange[], offset: number, useWhole: boolean) => {
      setPhase("render");
      setFailure(null);
      setStopRequested(false);
      stopRef.current = false;
      if (offset === 0) blobs.current = [];
      try {
        const outcome = await renderSessionVideo({
          sessionId,
          prefs: prefsRef.current,
          bgImage: bgFile,
          ranges: useWhole
            ? undefined
            : subset.map((r) => ({
                start: r.start,
                end: r.end,
                name: r.name || undefined,
              })),
          keepFiles: true,
          onCount: (_count, names) =>
            setFiles((rows) => [
              ...rows.slice(0, offset),
              ...initialFiles(names),
            ]),
          onFile: (p) =>
            setFiles((rows) =>
              applyFileProgress(rows, { ...p, index: p.index + offset }),
            ),
          shouldStop: () => stopRef.current,
          onProgress: () => undefined,
        });
        outcome.files.forEach((f, i) => (blobs.current[offset + i] = f));
        setPhase("done");
        announce(
          outcome.stopped
            ? `Export arrêté : ${outcome.files.length + offset} vidéo(s) prête(s).`
            : `${outcome.files.length + offset} vidéo(s) prête(s) et téléchargée(s).`,
        );
      } catch (error) {
        const index =
          error instanceof VideoFileError ? error.index + offset : offset;
        if (error instanceof VideoFileError)
          error.done.forEach((f, i) => (blobs.current[offset + i] = f));
        const message =
          error instanceof Error ? error.message : "Export vidéo impossible.";
        setFiles((rows) => failFile(rows, index));
        setFailure({
          message,
          index,
          memory: error instanceof VideoFileError && error.memory,
        });
        setPhase("error");
        onError(message);
      }
    },
    [announce, bgFile, onError, sessionId],
  );
  const exportNow = () => {
    setSheet(false);
    setFiles([]);
    void run(ranges, 0, whole);
  };
  const resume = (lighter: boolean) => {
    if (!failure) return;
    if (lighter) {
      patch({ resolution: 1080, fps: 30 });
      prefsRef.current = { ...prefsRef.current, resolution: 1080, fps: 30 };
    }
    void run(ranges.slice(failure.index), failure.index, whole);
  };
  const redownload = (index: number | null) => {
    const list = index === null ? blobs.current.map((_, i) => i) : [index];
    for (const i of list) {
      const f = blobs.current[i];
      if (f?.blob) downloadBlob(f.blob, f.name);
    }
  };

  // --- aperçu réduit sur téléphone --------------------------------------------------------------
  useEffect(() => {
    const node = stageWrap.current;
    if (!node || wide) return;
    const observer = new IntersectionObserver(([entry]) =>
      setMiniShown(!entry.isIntersecting && entry.boundingClientRect.top < 0),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [wide]);

  const loading = !prefsReady || (!loadFailed && (!intervals || !peaks));
  const empty = !loading && cardCount === 0;
  const bordPhase: ExportPhase = loading
    ? "loading"
    : empty || loadFailed
      ? "empty"
      : phase;
  const caption =
    selected && previewAt !== null
      ? `Image à ${formatClock(previewAt)} · plage ${selectedIndex + 1} · le texte vient toujours du corpus`
      : undefined;
  const bordProps: BordereauProps = {
    phase: bordPhase,
    count: ranges.length,
    seconds,
    formatLabel: formatName(prefs.orientation),
    width: frameSize.width,
    height: frameSize.height,
    fps: prefs.fps,
    weight,
    level,
    renderTime: renderTimeFr(seconds, prefs),
    firstFileName: fileNames[0] ?? "",
    apiJson,
    files,
    failure,
    stopRequested,
    canLighten: prefs.resolution > 1080 || prefs.fps > 30,
    onExport: exportNow,
    onStop: () => {
      stopRef.current = true;
      setStopRequested(true);
      announce("L’export s’arrêtera après la vidéo en cours.");
    },
    onResume: resume,
    onNew: () => {
      setPhase("idle");
      setFiles([]);
      blobs.current = [];
    },
    onRedownload: redownload,
    onLighten: () => {
      patch({ resolution: 1080, fps: 30 });
      announce("Qualité ramenée à 1080p, 30 images par seconde.");
    },
    onGoVerify,
  };

  const whatSummary = whole
    ? `Tout l’audio · ${formatDurationFr(seconds)}`
    : `${ranges.length} plage${ranges.length > 1 ? "s" : ""} · ${formatDurationFr(seconds)}`;
  const lookSummary = `${formatName(prefs.orientation)} · ${backgroundName(selectedBg, bgFile !== null)} · arabe ${sizeName(prefs.arabicSize)}`;
  const qualitySummary = `${prefs.resolution}p · ${prefs.fps} im/s · ≈ ${megabytesFr(weight.totalMb)}`;

  return (
    <div className="xr-grid" data-testid="video-panel">
      <div className="xr-main">
        <Chapter
          n={1}
          title="Ce que tu exportes"
          summary={loading ? "…" : whatSummary}
          open={open.what}
          onToggle={() => setOpen((o) => ({ ...o, what: !o.what }))}
          testId="chap-what"
        >
          {loading ? (
            <div aria-busy="true">
              <div className="xr-skel" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <p className="xr-lead" role="status">
                Lecture de la forme d’onde…
              </p>
            </div>
          ) : loadFailed ? (
            <div
              className="xr-empty"
              role="alert"
              data-testid="video-load-failed"
            >
              <p>
                <b>La forme d’onde n’a pas pu être lue.</b> Sans elle, la frise
                ne peut pas se dessiner et la vidéo ne peut pas se fabriquer.
                Recharge la page ; si cela continue, la copie d’écoute de cette
                session est peut-être indisponible sur ce serveur.
              </p>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => window.location.reload()}
              >
                Recharger
              </button>
            </div>
          ) : empty ? (
            <div className="xr-empty" data-testid="video-empty">
              <svg viewBox="0 0 120 60" aria-hidden="true">
                <path d="M4 30h112" />
                {[14, 30, 48, 70, 90, 104].map((x, i) => (
                  <rect
                    key={x}
                    x={x}
                    y={22 - (i % 3) * 3}
                    width="10"
                    height={16 + (i % 3) * 6}
                    rx="2"
                  />
                ))}
              </svg>
              <p>
                <b>Aucun passage coranique avec du texte.</b> Cet enregistrement
                ne contient que des passages non coraniques ou incertains : la
                vidéo n’aurait rien à afficher. Vérifie d’abord les passages
                ambigus.
              </p>
              <button
                type="button"
                className="btn btn--secondary"
                onClick={onGoVerify}
              >
                Aller à Vérifier
              </button>
            </div>
          ) : (
            <>
              <div className="xr-quick">
                <button
                  type="button"
                  className="xr-chip"
                  aria-pressed={whole}
                  data-testid="quick-all"
                  onClick={allAudio}
                >
                  <XIcon name="wave" />
                  Tout l’audio
                </button>
                <button
                  type="button"
                  className="xr-chip"
                  data-testid="quick-verses"
                  disabled={proposed.length === 0}
                  onClick={perVerse}
                >
                  <XIcon name="brackets" />
                  Un verset = une vidéo
                </button>
                <button
                  type="button"
                  className="xr-chip"
                  data-testid="quick-add"
                  disabled={proposed.length === 0 || ranges.length >= 50}
                  onClick={addNearCenter}
                >
                  <XIcon name="plus" />
                  Ajouter une plage
                </button>
              </div>
              <RangeTimeline
                duration={duration}
                peaks={peaks}
                intervals={intervals ?? []}
                ranges={ranges}
                selectedId={selectedId}
                view={view}
                onView={setView}
                onSelect={select}
                onChange={changeRange}
                onGestureEnd={(id, at) => {
                  setSelectedId(id);
                  setPreviewAt(at);
                }}
                onRemove={remove}
                onAddVerse={addAt}
                targets={targets}
                silences={silences}
                magnet={prefs.snapToSilence}
                thumbs={thumbs}
                playing={playingRange !== null}
                clock={player.store}
                onTogglePlay={togglePlay}
                announce={announce}
              />
              <RangeList
                ranges={ranges}
                selectedId={selectedId}
                intervals={intervals ?? []}
                duration={duration}
                onSelect={select}
                onChange={(id, next) => {
                  changeRange(id, next);
                  setPreviewAt(next.start);
                }}
                onRename={(id, name) =>
                  setRanges((list) =>
                    list.map((r) => (r.id === id ? { ...r, name } : r)),
                  )
                }
                onUp={(id) => {
                  setRanges((list) => moveUp(list, id));
                  announce("Plage montée.");
                }}
                onDown={(id) => {
                  setRanges((list) => moveDown(list, id));
                  announce("Plage descendue.");
                }}
                onRemove={remove}
              />
              <BreathSettings
                before={prefs.paddingBefore}
                after={prefs.paddingAfter}
                snap={prefs.snapToSilence}
                onChange={(next) =>
                  patch({
                    ...(next.before !== undefined
                      ? { paddingBefore: next.before }
                      : {}),
                    ...(next.after !== undefined
                      ? { paddingAfter: next.after }
                      : {}),
                    ...(next.snap !== undefined
                      ? { snapToSilence: next.snap }
                      : {}),
                  })
                }
              />
            </>
          )}
        </Chapter>

        <Chapter
          n={2}
          title="À quoi elle ressemble"
          summary={lookSummary}
          open={open.look}
          onToggle={() => setOpen((o) => ({ ...o, look: !o.look }))}
          testId="chap-look"
        >
          <VideoLook
            prefs={prefs}
            patch={patch}
            isVideo={isVideo}
            sourceSize={sourceSize}
            sourceUnreadable={videoCandidate && videoChecked && !isVideo}
            selectedBg={selectedBg}
            upload={bgFile}
            uploadThumb={bgThumb}
            onUpload={pickUpload}
            onChooseBg={(id) => {
              pickUpload(null);
              patch({ background: id });
            }}
          />
        </Chapter>

        <Chapter
          n={3}
          title="Qualité et poids"
          summary={qualitySummary}
          open={open.quality}
          onToggle={() => setOpen((o) => ({ ...o, quality: !o.quality }))}
          testId="chap-quality"
        >
          <QualityTiers
            resolution={prefs.resolution}
            fps={prefs.fps}
            weightFor={weightFor}
            onPick={(resolution, fps) => patch({ resolution, fps })}
          />
          <WeightGauge
            weight={weight}
            level={level}
            seconds={seconds}
            width={frameSize.width}
            height={frameSize.height}
            fps={prefs.fps}
          />
          <CustomQuality
            resolution={prefs.resolution}
            fps={prefs.fps}
            onResolution={(resolution) => patch({ resolution })}
            onFps={(fps) => patch({ fps })}
          />
        </Chapter>
      </div>

      <aside className="xr-side" aria-label="Aperçu et récapitulatif">
        <div ref={stageWrap} className="xr-stage-wrap">
          <VideoPreview
            sessionId={sessionId}
            intervals={intervals}
            peaks={peaks}
            prefs={prefs}
            upload={bgFile}
            isVideo={isVideo}
            sourceSize={sourceSize}
            at={previewAt}
            caption={caption}
          />
        </div>
        {wide ? (
          <Bordereau {...bordProps} primaryTestId="video-export" />
        ) : null}
      </aside>

      {!wide ? (
        <>
          <div
            className="xr-ministage"
            data-show={miniShown || undefined}
            aria-hidden={!miniShown}
          >
            <p>
              <b>Aperçu</b>
              {selected ? (
                <>
                  {" "}
                  · plage {selectedIndex + 1} ·{" "}
                  <span className="mono">
                    {formatClock(previewAt ?? selected.start)}
                  </span>
                </>
              ) : null}
            </p>
            <button
              type="button"
              className="btn btn--ghost"
              tabIndex={miniShown ? 0 : -1}
              onClick={() =>
                stageWrap.current?.scrollIntoView({
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)",
                  ).matches
                    ? "auto"
                    : "smooth",
                  block: "start",
                })
              }
            >
              Voir
            </button>
          </div>
          <ExportDock
            props={{ ...bordProps, primaryTestId: "video-export" }}
            onOpenSheet={() => setSheet(true)}
          />
          <ExportSheet open={sheet} onClose={() => setSheet(false)}>
            <Bordereau {...bordProps} primaryTestId="video-export-sheet" />
          </ExportSheet>
        </>
      ) : null}
    </div>
  );
}
