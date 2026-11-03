"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import {
  fetchVideoInfo,
  isVideoExtension,
  loadSourceVideo,
} from "@/lib/export-video-assets";
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
import { resolveOrientation, type VideoPrefs } from "@/lib/export-video-prefs";
import {
  applyFileProgress,
  failFile,
  initialFiles,
  renderErrorText,
  type FileRow,
} from "@/lib/export-video-progress";
import {
  cancelServerJob,
  fetchServerJob,
  fetchSessionJobs,
  isActiveJob,
  serverJobFileUrl,
  startServerExport,
  type ServerJob,
} from "@/lib/export-video-jobs-client";
import {
  announceVideosChanged,
  type SavedVideo,
} from "@/lib/export-video-library";
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
import { useShell } from "../shell";
import { CustomQuality, QualityTiers, WeightGauge } from "./video-quality";

/**
 * Onglet « Vidéo » de l'export, direction « Le rouleau et les signets » : 1. ce que tu exportes
 * (frise + plages + souffle), 2. à quoi elle ressemble, 3. qualité et poids ; l'aperçu et le
 * bordereau restent visibles (colonne collante au bureau, bandeau + dock sur téléphone). Les
 * réglages se mémorisent sur le compte (préférence `videoPrefs`).
 */
type Player = ReturnType<typeof usePlayer>;
const TL = EXPORT_VIDEO_CONFIG.timeline;
const THUMBS = EXPORT_VIDEO_CONFIG.thumbnails;

/** Intervalle de suivi d'un export confié au serveur. */
const FOLLOW_MS = 1200;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Lignes de fichiers d'un job : terminé, en cours (la vidéo à `files_done`), en attente. */
function rowsOf(names: readonly string[], job: ServerJob): FileRow[] {
  return names.map((name, i) => {
    if (job.state === "done" || i < job.files_done)
      return { name, state: "done", ratio: 1, bytes: null };
    if (job.state === "failed" && i === job.files_done)
      return { name, state: "err", ratio: 0, bytes: null };
    if (isActiveJob(job) && i === job.files_done)
      return { name, state: "run", ratio: job.ratio, bytes: null };
    return { name, state: "wait", ratio: 0, bytes: null };
  });
}

/** Téléchargement d'une adresse du serveur, sans quitter la page. */
function downloadUrl(url: string, name: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

export function VideoPanel({
  sessionId,
  player,
  onError,
  onGoVerify,
  announce,
  existingVideos,
  reuseVideos,
}: {
  sessionId: string;
  player: Player;
  onError: (message: string) => void;
  /** Absent pour le récitateur : pas de vérification à lui proposer. */
  onGoVerify?: () => void;
  announce: (message: string) => void;
  /** Vidéos déjà gardées sur le serveur et réutilisation d'une vidéo identique. */
  existingVideos: SavedVideo[];
  reuseVideos: boolean;
}) {
  const savedRef = useRef({ existingVideos, reuseVideos });
  savedRef.current = { existingVideos, reuseVideos };
  const wide = useMedia("(min-width: 1024px)");
  // Réglages du compte (pas de l’appareil) : déjà chargés avec la page, donc aucun clignotement.
  const { prefs: accountPrefs, update } = useShell();
  const [prefs, setPrefs] = useState<VideoPrefs>(accountPrefs.videoPrefs);
  const [prefsReady, setPrefsReady] = useState(false);
  const [sessionName, setSessionName] = useState("");
  const [intervals, setIntervals] = useState<readonly Interval[] | null>(null);
  const [peaks, setPeaks] = useState<ListeningPeaks | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isVideo, setIsVideo] = useState(false);
  const [videoCandidate, setVideoCandidate] = useState(false);
  const [videoChecked, setVideoChecked] = useState(false);
  // Le navigateur de cette personne sait-il afficher l'image dans l'aperçu ? (l'export, lui, est sur le serveur)
  const [previewReadable, setPreviewReadable] = useState(true);
  // Ce que le COMPTE a retenu : le défaut « vidéo d'origine » d'une session vidéo n'y entre jamais.
  const accountRef = useRef(accountPrefs.videoPrefs);
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
  const thumbUrl = useRef<string | null>(null);
  const stageWrap = useRef<HTMLDivElement>(null);
  const playing = useStoreValue(player.store, (s) => s.playing);
  const [playingRange, setPlayingRange] = useState<number | null>(null);
  useEffect(() => {
    if (!playing) setPlayingRange(null);
  }, [playing]);

  // --- données : résultat, crêtes, vidéo d'origine, imagettes ------------------------------
  useEffect(() => {
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
          void (async () => {
            // C'est le serveur qui dit s'il y a une image : un téléphone qui ne décode pas la vidéo ne doit
            // jamais faire disparaître « Vidéo d'origine ». Le navigateur ne sert qu'à juger de l'aperçu.
            const info = await fetchVideoInfo(sessionId);
            if (cancelled) return;
            if (info) {
              setVideoChecked(true);
              if (!info.has_video) return;
              setIsVideo(true);
              setSourceSize({ width: info.width, height: info.height });
            }
            const element = await loadSourceVideo(sessionId);
            if (cancelled) return;
            if (!info) {
              // Serveur injoignable : on retombe sur ce que le navigateur voit.
              setVideoChecked(true);
              if (!element) return;
              setIsVideo(true);
              setSourceSize({
                width: element.videoWidth,
                height: element.videoHeight,
              });
            }
            setPreviewReadable(element !== null);
            if (element) {
              element.removeAttribute("src");
              element.load();
            }
          })();
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

  // Une vidéo envoyée ressort telle quelle, avec la traduction par-dessus : « Vidéo d'origine » est le fond ET le
  // format par défaut, quels que soient les réglages enregistrés du compte. Un choix de la personne le remplace
  // pour cette session seulement ; ce défaut n'est jamais écrit dans ses préférences.
  const defaulted = useRef(false);
  useEffect(() => {
    if (!isVideo || defaulted.current) return;
    defaulted.current = true;
    const next: VideoPrefs = {
      ...prefsRef.current,
      orientation: "source",
      background: SOURCE_BACKGROUND_ID,
    };
    prefsRef.current = next;
    setPrefs(next);
  }, [isVideo]);

  const patch = useCallback(
    (next: Partial<VideoPrefs>) => {
      const value = { ...prefsRef.current, ...next };
      prefsRef.current = value;
      setPrefs(value);
      accountRef.current = { ...accountRef.current, ...next };
      update({ videoPrefs: accountRef.current });
    },
    [update],
  );

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

  // --- export : confié au serveur ---------------------------------------------------------------
  // Le rendu tourne sur le serveur (job) : quitter la page ne l'interrompt pas. Cette page ne fait
  // que suivre l'avancement ; à son retour, un export encore actif reprend l'affichage.
  const jobRef = useRef<string | null>(null);
  const aliveRef = useRef(true);
  const links = useRef<Array<{ name: string; url: string }>>([]);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const follow = useCallback(
    async (jobId: string, names: string[], offset: number) => {
      jobRef.current = jobId;
      for (;;) {
        let job: ServerJob;
        try {
          job = await fetchServerJob(sessionId, jobId);
        } catch {
          // Réseau coupé ou page en transition : le rendu continue côté serveur, on réessaie.
          await sleep(FOLLOW_MS);
          if (!aliveRef.current) return;
          continue;
        }
        if (!aliveRef.current) return;
        setFiles((rows) => [...rows.slice(0, offset), ...rowsOf(names, job)]);
        if (isActiveJob(job)) {
          await sleep(FOLLOW_MS);
          if (!aliveRef.current) return;
          continue;
        }
        jobRef.current = null;
        if (job.state === "done") {
          links.current = job.downloads.map((d) => ({
            name: d.name,
            url: serverJobFileUrl(sessionId, job.id, d.index),
          }));
          setPhase("done");
          setStopRequested(false);
          announceVideosChanged();
          announce(
            `${job.downloads.length} vidéo(s) prête(s), gardée(s) sur le serveur.`,
          );
        } else if (job.error === "Export annulé.") {
          setPhase("done");
          setStopRequested(false);
          announceVideosChanged();
          announce(
            `Export arrêté : ${job.files_done + offset} vidéo(s) prête(s).`,
          );
        } else {
          const message = job.error ?? "La vidéo n’a pas pu être fabriquée.";
          const index = job.files_done + offset;
          setFiles((rows) => failFile(rows, index));
          setFailure({ message, index, memory: false });
          setPhase("error");
          onError(message);
        }
        return;
      }
    },
    [announce, onError, sessionId],
  );

  const run = useCallback(
    async (subset: PlanRange[], offset: number, useWhole: boolean) => {
      setPhase("render");
      setFailure(null);
      setStopRequested(false);
      if (offset === 0) links.current = [];
      const names = subset.map((r) =>
        useWhole
          ? videoFileName(sessionName)
          : videoRangeFileName(
              sessionName,
              undefined,
              r,
              ranges.length,
              r.name,
            ),
      );
      try {
        const job = await startServerExport(
          sessionId,
          exportVideoRequest(
            prefsRef.current,
            useWhole ? [] : subset,
            duration,
          ),
          bgFile,
          savedRef.current.reuseVideos,
        );
        setFiles((rows) => [...rows.slice(0, offset), ...rowsOf(names, job)]);
        await follow(job.id, names, offset);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "L’export n’a pas pu démarrer.";
        setFiles((rows) => failFile(rows, offset));
        setFailure({ message, index: offset, memory: false });
        setPhase("error");
        onError(message);
      }
    },
    [bgFile, duration, follow, onError, ranges.length, sessionId, sessionName],
  );

  // Retour sur la page : un export encore en file ou en cours reprend son affichage.
  useEffect(() => {
    let cancelled = false;
    void fetchSessionJobs(sessionId)
      .then((jobs) => {
        const active = jobs.find(isActiveJob);
        if (!active || cancelled) return;
        const names = Array.from(
          { length: active.files_total ?? 1 },
          (_, i) => `Vidéo ${i + 1}`,
        );
        setPhase("render");
        setFiles(rowsOf(names, active));
        void follow(active.id, names, 0);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [follow, sessionId]);

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
    const list = index === null ? links.current.map((_, i) => i) : [index];
    for (const i of list) {
      const link = links.current[i];
      if (link) downloadUrl(link.url, link.name);
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
      setStopRequested(true);
      if (jobRef.current)
        void cancelServerJob(sessionId, jobRef.current).catch(() => undefined);
      announce("L’export s’arrêtera : la vidéo en cours est abandonnée.");
    },
    onResume: resume,
    onFinish: () => {
      const done = files.filter((f) => f.state === "done").length;
      setSheet(false);
      void run(ranges.slice(done), done, whole);
    },
    onNew: () => {
      setPhase("idle");
      setFiles([]);
      links.current = [];
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
              {onGoVerify ? (
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={onGoVerify}
                >
                  Aller à Vérifier
                </button>
              ) : null}
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
            previewUnavailable={isVideo && !previewReadable}
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
