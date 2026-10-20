"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import {
  activeIntervals,
  formatTime,
  type Recognition,
  type Interval,
} from "@/lib/recognition";
import type { Annotation, Review } from "@/lib/review";
import { audioAccept, bindAudioDrop } from "@/lib/audio-upload";
import Recorder from "./recorder";
import ValidationPanel from "./validation-panel";
import type { AsrChoice } from "@/lib/asr-choice";
import {
  ZOOM_SPANS,
  centeredScroll,
  formatTick,
  laneWidthPercent,
  percentAt,
  tickStep,
  ticks,
  visibleSpan,
} from "@/lib/timeline";

type Session = {
  id: string;
  name: string;
  audio_sha256: string;
  created_at: string;
  state: string;
  error: string | null;
  prediction_sha256: string | null;
  started_at: string | null;
  asr?: AsrChoice;
};
type Detail = {
  session: Session;
  result: Recognition | null;
  review: Review | null;
};
const labels: Record<string, string> = {
  recognized: "Reconnu",
  inferred: "Déduit",
  uncertain: "Incertain",
  non_quran: "Formule",
  abstention: "Abstention",
  wrong_verse: "Mauvais verset",
  missing_verse: "Verset manquant",
  repetition: "Répétition",
  timing: "Décalage",
  other: "Autre",
};
const states: Record<string, string> = {
  ready: "prêt",
  running: "en cours",
  done: "terminé",
  failed: "échec",
  cancelled: "annulé",
};
const engines: Record<string, string> = {
  fastconformer: "FastConformer",
  whisper: "Whisper",
  "muno-streaming": "Muno Streaming",
};
/** Couleur d'un intervalle sur la forme d'onde (mêmes teintes que les pistes). */
function regionColor(item: Interval): string {
  if (item.kind === "abstention") return "rgba(99, 116, 119, 0.22)";
  if (item.kind === "non_quran") return "rgba(118, 157, 154, 0.3)";
  if (item.status === "inferred") return "rgba(211, 184, 114, 0.28)";
  if (item.status === "uncertain") return "rgba(176, 147, 117, 0.34)";
  return "rgba(131, 168, 143, 0.34)";
}
type Peaks = { duration: number; peaks: number[] };
/** Arrêt d'un passage écouté : 10 ms avant sa fin, pour que la carte l'affiche encore. */
const STOP_MARGIN_S = 0.01;
/** Largeur minimale (px) d'un segment pour y écrire sa référence sur la forme d'onde. */
const REGION_LABEL_PX = 34;
const reasons: Record<string, string> = {
  silence: "Silence selon le moteur",
  empty_transcript: "Aucun texte exploitable",
  no_candidate: "Aucune correspondance",
  below_threshold: "Score insuffisant",
};
function intervalLabel(item: Interval) {
  return item.kind === "verse"
    ? item.status === "uncertain"
      ? `Références possibles : ${item.candidates.join(" · ") || "aucune"}`
      : item.ref || "Verset"
    : item.kind === "non_quran"
      ? item.label
      : reasons[item.reason];
}
function newAnnotation(
  mode: "point" | "range",
  start: number,
  end: number | null,
  target: number | null,
): Annotation {
  return {
    id: crypto.randomUUID(),
    mode,
    start_s: start,
    end_s: end,
    type: "other",
    description: "",
    expected_ref: null,
    target_index: target,
    status: "draft",
    updated_at: new Date().toISOString(),
  };
}
export default function ReviewApp() {
  const [sessions, setSessions] = useState<Session[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [time, setTime] = useState(0),
    [mediaDuration, setMediaDuration] = useState(0),
    [playing, setPlaying] = useState(false),
    [volume, setVolume] = useState(1),
    [speed, setSpeed] = useState(1),
    [dragActive, setDragActive] = useState(false),
    [selected, setSelected] = useState<number | null>(null),
    [filter, setFilter] = useState("all"),
    [follow, setFollow] = useState(true),
    [span, setSpan] = useState<number | null>(null),
    [peaks, setPeaks] = useState<Peaks | null>(null),
    [listening, setListening] = useState<"pending" | "ready" | "fallback">(
      "pending",
    ),
    [waveReady, setWaveReady] = useState(false),
    [lanesWidth, setLanesWidth] = useState(Infinity),
    [fontSize, setFontSize] = useState(40),
    [translation, setTranslation] = useState(true),
    [loop, setLoop] = useState(false),
    [draft, setDraft] = useState<Annotation | null>(null),
    [saveState, setSaveState] = useState(""),
    [elapsed, setElapsed] = useState(0);
  const [asrChoice, setAsrChoice] = useState<AsrChoice>("fastconformer");
  const audio = useRef<HTMLAudioElement>(null),
    wave = useRef<HTMLDivElement>(null),
    card = useRef<HTMLDivElement>(null),
    segmentList = useRef<HTMLDivElement>(null),
    file = useRef<HTMLInputElement>(null),
    resultFile = useRef<HTMLInputElement>(null),
    raf = useRef<number>(0),
    lanes = useRef<HTMLDivElement>(null),
    ws = useRef<import("wavesurfer.js").default | null>(null),
    regions = useRef<
      import("wavesurfer.js/dist/plugins/regions.esm.js").default | null
    >(null),
    timeline = useRef<{
      create: (typeof import("wavesurfer.js/dist/plugins/timeline.esm.js"))["default"]["create"];
      plugin: { destroy: () => void } | null;
    } | null>(null),
    stopAt = useRef<number | null>(null),
    seekRef = useRef<(index: number) => void>(() => {}),
    uploading = useRef(false),
    saved = useRef<string>("");
  const refreshList = useCallback(async () => {
    const r = await fetch("/api/sessions", { cache: "no-store" });
    if (r.ok) setSessions(await r.json());
  }, []);
  const open = useCallback(async (id: string) => {
    const r = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
    if (!r.ok) throw new Error("Session introuvable");
    const value: Detail = await r.json();
    setDetail(value);
    setDraft(null);
    setSelected(null);
    setTime(0);
    setMediaDuration(0);
    setPlaying(false);
    setSaveState("");
    saved.current = JSON.stringify(value.review?.annotations || []);
  }, []);
  useEffect(() => {
    refreshList().then(() => {
      const id = new URLSearchParams(location.search).get("session");
      if (id) open(id).catch(() => {});
    });
  }, [open, refreshList]);
  useEffect(() => {
    if (!detail || detail.session.state !== "running") return;
    const id = detail.session.id;
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`/api/sessions/${id}`, { cache: "no-store" });
        if (r.ok) {
          const value: Detail = await r.json();
          setDetail((current) =>
            current?.session.id === id
              ? { ...value, review: current.review || value.review }
              : current,
          );
          await refreshList();
        }
      } catch {
        /* prochaine interrogation */
      }
    }, 1800);
    return () => clearInterval(timer);
  }, [detail?.session.id, detail?.session.state, refreshList]);
  useEffect(() => {
    if (
      !detail ||
      detail.session.state !== "running" ||
      !detail.session.started_at
    )
      return;
    const tick = () =>
      setElapsed(
        Math.floor(
          (Date.now() - Date.parse(detail.session.started_at!)) / 1000,
        ),
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [detail]);
  useEffect(() => {
    if (!detail) return;
    const id = detail.session.id;
    let cancelled = false;
    setPeaks(null);
    setListening("pending");
    fetch(`/api/sessions/${id}/peaks`, { cache: "no-store" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (cancelled) return;
        setPeaks({ duration: data.duration, peaks: data.peaks });
        setListening("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setListening("fallback");
        setMessage(
          `${e instanceof Error ? e.message : "Copie d’écoute indisponible"}. Lecture du fichier original : le positionnement peut y être décalé de plusieurs secondes.`,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [detail?.session.id]);
  useEffect(() => {
    if (!audio.current) return;
    audio.current.volume = volume;
    audio.current.playbackRate = speed;
  }, [detail?.session.id, volume, speed]);
  useEffect(() => {
    const node = audio.current;
    if (!node) return;
    /** Fin d'un « Écouter ce passage » : arrêt juste avant la fin, la carte garde le passage. */
    const checkStop = () => {
      const end = stopAt.current;
      if (end === null || node.currentTime < end - STOP_MARGIN_S) return;
      node.pause();
      node.currentTime = end - STOP_MARGIN_S;
    };
    const tick = () => {
      checkStop();
      setTime(node.currentTime);
      if (!node.paused) raf.current = requestAnimationFrame(tick);
    };
    // requestAnimationFrame est suspendu quand l'onglet est masqué : timeupdate prend le relais.
    const onTimeUpdate = () => {
      checkStop();
      if (document.hidden) setTime(node.currentTime);
    };
    const onPlay = () => {
      setSelected(null);
      setPlaying(true);
      tick();
    };
    const onPause = () => {
      stopAt.current = null;
      setPlaying(false);
      cancelAnimationFrame(raf.current);
      setTime(node.currentTime);
    };
    const onSeek = () => setTime(node.currentTime);
    const onDuration = () =>
      setMediaDuration(Number.isFinite(node.duration) ? node.duration : 0);
    node.addEventListener("play", onPlay);
    node.addEventListener("pause", onPause);
    node.addEventListener("seeked", onSeek);
    node.addEventListener("timeupdate", onTimeUpdate);
    node.addEventListener("ended", onPause);
    node.addEventListener("loadedmetadata", onDuration);
    node.addEventListener("durationchange", onDuration);
    document.addEventListener("visibilitychange", onSeek);
    onDuration();
    onSeek();
    return () => {
      cancelAnimationFrame(raf.current);
      node.removeEventListener("play", onPlay);
      node.removeEventListener("pause", onPause);
      node.removeEventListener("seeked", onSeek);
      node.removeEventListener("timeupdate", onTimeUpdate);
      node.removeEventListener("ended", onPause);
      node.removeEventListener("loadedmetadata", onDuration);
      node.removeEventListener("durationchange", onDuration);
      document.removeEventListener("visibilitychange", onSeek);
    };
  }, [detail?.session.id]);
  useEffect(() => {
    if (!loop || !draft || !audio.current) return;
    const start =
      draft.mode === "range" ? draft.start_s : Math.max(0, draft.start_s - 2);
    const end = draft.mode === "range" ? draft.end_s! : draft.start_s + 2;
    if (time >= end || time < start) audio.current.currentTime = start;
  }, [time, loop, draft]);
  const intervals = detail?.result?.intervals || [];
  const duration =
    mediaDuration || peaks?.duration || detail?.result?.source.duration_s || 0;
  const active = activeIntervals(intervals, time);
  const currentIndex = intervals.findIndex(
    (i) => i.t && i.t[0] <= time && time < i.t[1] && i.kind === "verse",
  );
  const chosen = selected !== null ? intervals[selected] : null;
  const shown =
    chosen && (chosen.t === null || (chosen.t[0] <= time && time < chosen.t[1]))
      ? chosen
      : currentIndex >= 0
        ? intervals[currentIndex]
        : null;
  useEffect(() => {
    const node = audio.current;
    if (!node || !detail || !wave.current || listening === "pending") return;
    let destroyed = false;
    let instance: import("wavesurfer.js").default | null = null;
    Promise.all([
      import("wavesurfer.js"),
      import("wavesurfer.js/dist/plugins/regions.esm.js"),
      import("wavesurfer.js/dist/plugins/timeline.esm.js"),
    ]).then(
      ([
        { default: WaveSurfer },
        { default: Regions },
        { default: Timeline },
      ]) => {
        if (destroyed || !wave.current) return;
        const regionPlugin = Regions.create();
        instance = WaveSurfer.create({
          container: wave.current,
          media: node,
          // Crêtes calculées par le serveur sur la copie d'écoute : rien à décoder ici.
          ...(peaks
            ? {
                peaks: [Float32Array.from(peaks.peaks)],
                duration: peaks.duration,
              }
            : {}),
          waveColor: "#697878",
          progressColor: "#b4ddac",
          cursorColor: "#f7e7a8",
          cursorWidth: 2,
          height: 96,
          barWidth: 2,
          barGap: 1,
          normalize: true,
          autoScroll: true,
          autoCenter: true,
          plugins: [regionPlugin],
        });
        timeline.current = {
          create: (options) => Timeline.create(options),
          plugin: null,
        };
        regionPlugin.on("region-clicked", (region, event) => {
          event.stopPropagation();
          seekRef.current(Number(region.id.slice(2)));
        });
        instance.on("ready", () => setWaveReady(true));
        instance.on("interaction", () => {
          stopAt.current = null;
          setFollow(false);
        });
        instance.on("error", () =>
          setMessage(
            "Forme d’onde indisponible ; le lecteur et la liste restent utilisables.",
          ),
        );
        ws.current = instance;
        regions.current = regionPlugin;
      },
    );
    return () => {
      destroyed = true;
      instance?.destroy();
      ws.current = null;
      regions.current = null;
      timeline.current = null;
      setWaveReady(false);
    };
  }, [detail?.session.id, listening, peaks]);
  useEffect(() => {
    const plugin = regions.current;
    if (!waveReady || !plugin) return;
    plugin.clearRegions();
    const pxPerSecond =
      wave.current && duration
        ? wave.current.clientWidth / visibleSpan(duration, span)
        : 0;
    intervals.forEach((item, index) => {
      if (!item.t) return;
      const wide = (item.t[1] - item.t[0]) * pxPerSecond >= REGION_LABEL_PX;
      plugin.addRegion({
        id: `i-${index}`,
        start: item.t[0],
        end: item.t[1],
        color: regionColor(item),
        drag: false,
        resize: false,
        content:
          wide &&
          item.kind === "verse" &&
          item.status !== "uncertain" &&
          item.ref
            ? item.ref
            : undefined,
      });
    });
  }, [waveReady, detail?.result, span, duration]);
  useEffect(() => {
    const plugin = regions.current;
    if (!waveReady || !plugin) return;
    // Les régions vivent dans le DOM fantôme de wavesurfer : style posé directement.
    for (const region of plugin.getRegions())
      if (region.element)
        region.element.style.outline =
          region.id === `i-${selected}` ? "2px solid #f8e8b8" : "";
  }, [waveReady, selected, detail?.result]);
  useEffect(() => {
    const instance = ws.current;
    if (!waveReady || !instance || !wave.current || !duration) return;
    instance.zoom(
      span === null
        ? 0
        : wave.current.clientWidth / visibleSpan(duration, span),
    );
    // Graduations de la forme d'onde : même pas que celles des pistes.
    const marks = timeline.current;
    if (marks) {
      marks.plugin?.destroy();
      const step = tickStep(
        visibleSpan(duration, span),
        wave.current.clientWidth,
      );
      const plugin = marks.create({
        height: 18,
        timeInterval: step,
        primaryLabelInterval: 1,
        secondaryLabelInterval: 1,
        formatTimeCallback: (t) => formatTick(t, step),
        style: { color: "#a0b1a8", fontSize: "10px" },
      });
      instance.registerPlugin(plugin);
      marks.plugin = plugin;
    }
    // Après le changement d'échelle : la position courante revient au centre des deux vues.
    centerOn(audio.current?.currentTime ?? 0);
  }, [waveReady, span, duration]);
  useEffect(() => {
    const box = lanes.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setLanesWidth(box.clientWidth));
    observer.observe(box);
    return () => observer.disconnect();
  }, [detail?.session.id]);
  useEffect(() => {
    ws.current?.setOptions({ autoScroll: follow, autoCenter: follow });
  }, [follow, waveReady]);
  useEffect(() => {
    const box = lanes.current;
    if (!follow || !box || span === null) return;
    box.scrollLeft = centeredScroll(
      time,
      duration,
      box.clientWidth,
      box.scrollWidth,
    );
  }, [time, follow, span, duration]);
  useEffect(() => {
    if (follow && currentIndex >= 0)
      segmentList.current
        ?.querySelector(`[data-index="${currentIndex}"]`)
        ?.scrollIntoView({ block: "nearest" });
  }, [currentIndex, follow]);
  useEffect(() => {
    if (
      !card.current ||
      !shown ||
      matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const ctx = gsap.context(() =>
      gsap.fromTo(
        card.current,
        { opacity: 0.65, y: 7 },
        { opacity: 1, y: 0, duration: 0.22, ease: "power2.out" },
      ),
    );
    return () => ctx.revert();
  }, [selected, currentIndex, detail?.session.id]);
  useEffect(() => {
    if (!detail || !draft) return;
    const annotations = [
      ...(detail.review?.annotations || []).filter((a) => a.id !== draft.id),
      draft,
    ];
    const key = JSON.stringify(annotations);
    if (key === saved.current) return;
    setSaveState("Enregistrement…");
    const timer = setTimeout(async () => {
      const review: Review = {
        schema: "aqr.review/1",
        session_id: detail.session.id,
        audio_sha256: detail.session.audio_sha256,
        prediction_sha256: detail.session.prediction_sha256,
        annotations,
        updated_at: new Date().toISOString(),
      };
      try {
        const r = await fetch(`/api/sessions/${detail.session.id}/review`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(review),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        saved.current = key;
        setDetail((d) =>
          d && d.session.id === detail.session.id ? { ...d, review } : d,
        );
        setSaveState("Enregistré localement");
      } catch (e) {
        setSaveState(
          `Échec de sauvegarde : ${e instanceof Error ? e.message : "erreur"}`,
        );
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [draft, detail?.session.id, detail?.session.prediction_sha256]);
  const createSession = useCallback(
    async (
      selectedAudio: File,
      selectedResult?: File,
      sourceKind: "file" | "microphone" = "file",
    ) => {
      const form = new FormData();
      form.append("audio", selectedAudio);
      form.append("source_kind", sourceKind);
      if (selectedResult) form.append("result", selectedResult);
      const r = await fetch("/api/sessions", { method: "POST", body: form });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await refreshList();
      await open(data.id);
      history.replaceState(null, "", `?session=${data.id}`);
      return data.id as string;
    },
    [open, refreshList],
  );
  const uploadFiles = useCallback(
    async (selectedAudio?: File, selectedResult?: File) => {
      if (!selectedAudio || uploading.current) return;
      uploading.current = true;
      setBusy(true);
      setMessage("");
      try {
        await createSession(selectedAudio, selectedResult);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Import impossible");
      } finally {
        uploading.current = false;
        setBusy(false);
      }
    },
    [createSession],
  );
  const analyzeRecording = useCallback(
    async (selectedAudio: File) => {
      if (uploading.current) throw new Error("Un import est déjà en cours.");
      uploading.current = true;
      setBusy(true);
      setMessage("");
      try {
        const id = await createSession(selectedAudio, undefined, "microphone");
        try {
          const r = await fetch(`/api/sessions/${id}/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ asr: asrChoice }),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error);
          await open(id);
          await refreshList();
        } catch (error) {
          setMessage(
            `Audio conservé dans la session. L’analyse n’a pas démarré : ${error instanceof Error ? error.message : "erreur inconnue"}`,
          );
        }
      } finally {
        uploading.current = false;
        setBusy(false);
      }
    },
    [asrChoice, createSession, open, refreshList],
  );
  useEffect(() => {
    return bindAudioDrop(window, {
      onActive: setDragActive,
      onAudio: (selectedAudio) => void uploadFiles(selectedAudio),
      onError: setMessage,
    });
  }, [uploadFiles]);
  async function action(method: "POST" | "DELETE") {
    if (!detail) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/sessions/${detail.session.id}/run`, {
        method,
        ...(method === "POST"
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ asr: asrChoice }),
            }
          : {}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await open(detail.session.id);
      await refreshList();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Action impossible");
    } finally {
      setBusy(false);
    }
  }
  /** Amène `t` au centre de la forme d'onde et des pistes. */
  function centerOn(t: number) {
    const box = lanes.current;
    if (box)
      box.scrollLeft = centeredScroll(
        t,
        duration,
        box.clientWidth,
        box.scrollWidth,
      );
    if (ws.current && duration)
      ws.current.setScrollTime(
        Math.max(0, t - visibleSpan(duration, span) / 2),
      );
  }
  /** Sélectionne un intervalle et place le lecteur sur son début, sans lancer la lecture. */
  function seek(index: number) {
    const item = intervals[index];
    setSelected(index);
    setFollow(false);
    stopAt.current = null;
    if (item?.t && audio.current) {
      audio.current.currentTime = item.t[0];
      setTime(item.t[0]);
      centerOn(item.t[0]);
    }
  }
  seekRef.current = seek;
  /** Joue exactement l'intervalle [début, fin] puis s'arrête. */
  function playSegment(item: Interval) {
    const node = audio.current;
    if (!node || !item.t) return;
    const [start, end] = item.t;
    node.currentTime = start;
    centerOn(start);
    void node
      .play()
      .then(() => {
        stopAt.current = end;
      })
      .catch(() =>
        setMessage("Lecture impossible pour cet audio dans ce navigateur."),
      );
  }
  function togglePlayback() {
    const node = audio.current;
    if (!node) return;
    if (node.paused)
      void node
        .play()
        .catch(() =>
          setMessage("Lecture impossible pour cet audio dans ce navigateur."),
        );
    else node.pause();
  }
  function patchDraft(patch: Partial<Annotation>) {
    if (draft)
      setDraft({ ...draft, ...patch, updated_at: new Date().toISOString() });
  }
  async function removeDraft() {
    if (!detail || !draft) return;
    const annotations = (detail.review?.annotations || []).filter(
      (a) => a.id !== draft.id,
    );
    const review: Review = {
      schema: "aqr.review/1",
      session_id: detail.session.id,
      audio_sha256: detail.session.audio_sha256,
      prediction_sha256: detail.session.prediction_sha256,
      annotations,
      updated_at: new Date().toISOString(),
    };
    try {
      const r = await fetch(`/api/sessions/${detail.session.id}/review`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(review),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      saved.current = JSON.stringify(annotations);
      setDetail({ ...detail, review });
      setDraft(null);
      setSaveState("Signalement annulé · révision conservée");
    } catch (e) {
      setSaveState(
        `Échec de sauvegarde : ${e instanceof Error ? e.message : "erreur"}`,
      );
    }
  }
  function startAnnotation(mode: "point" | "range") {
    setLoop(false);
    const start =
      mode === "range" ? Math.min(time, Math.max(0, duration - 0.5)) : time;
    const end =
      mode === "range" ? Math.min(duration || start + 5, start + 5) : null;
    setDraft(
      newAnnotation(
        mode,
        Number(start.toFixed(3)),
        end === null ? null : Number(end.toFixed(3)),
        selected ?? (currentIndex >= 0 ? currentIndex : null),
      ),
    );
  }
  const visible = intervals
    .map((item, index) => ({ item, index }))
    .filter(
      ({ item }) =>
        filter === "all" ||
        (filter === "verse"
          ? item.kind === "verse"
          : filter === "uncertain"
            ? item.kind === "verse" && item.status !== "recognized"
            : item.kind === filter),
    );
  const laneItems = useMemo(
    () =>
      (["main", "inferred"] as const).map((track) => (
        <div key={track} className="track">
          {intervals.map((item, index) =>
            item.t &&
            (track === "inferred") ===
              (item.kind === "verse" && item.status === "inferred") ? (
              <button
                key={index}
                className={`track-item ${item.kind} ${item.kind === "verse" ? item.status : ""} ${selected === index ? "selected" : ""}`}
                style={{
                  left: `${percentAt(item.t[0], duration)}%`,
                  width: `${percentAt(item.t[1] - item.t[0], duration)}%`,
                }}
                onClick={() => seekRef.current(index)}
                title={`${intervalLabel(item)} · ${formatTime(item.t[0])} – ${formatTime(item.t[1])}`}
              />
            ) : null,
          )}
        </div>
      )),
    [intervals, selected, duration],
  );
  const tickMarks = useMemo(() => {
    const step = tickStep(visibleSpan(duration, span), lanesWidth);
    return ticks(duration, step).map((t) => (
      <span key={t} style={{ left: `${percentAt(t, duration)}%` }}>
        {formatTick(t, step)}
      </span>
    ));
  }, [duration, span, lanesWidth]);
  const uploadPanel = (
    <div className="upload">
      <label className="engine-choice">
        Moteur de reconnaissance
        <select
          value={asrChoice}
          onChange={(event) => setAsrChoice(event.target.value as AsrChoice)}
        >
          <option value="fastconformer">FastConformer · actuel</option>
          <option value="whisper">Whisper · challenger</option>
          <option value="muno-streaming">
            Muno Streaming · ONNX quantifié
          </option>
        </select>
        <small>
          Choisi pour la prochaine analyse ; chaque session conserve le moteur
          utilisé.
        </small>
      </label>
      <div className="upload-sources">
        <Recorder onAnalyze={analyzeRecording} />
        <div className="upload-file">
          <span className="upload-title">
            <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
              <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
            Importer un fichier
          </span>
          <label>
            Fichier audio
            <input ref={file} type="file" accept={audioAccept} />
          </label>
          <label>
            <span>
              Résultat existant <span className="optional">· facultatif</span>
            </span>
            <input
              ref={resultFile}
              type="file"
              accept=".json,application/json"
            />
          </label>
          <button
            className="primary upload-submit"
            onClick={() =>
              void uploadFiles(
                file.current?.files?.[0],
                resultFile.current?.files?.[0],
              )
            }
            disabled={busy}
          >
            Importer dans l’atelier <span>↗</span>
          </button>
          <small>Ou dépose un audio n’importe où sur la page.</small>
        </div>
      </div>
      <small>
        Fichiers conservés localement hors Git. L’import JSON exige le même
        audio, vérifié par SHA-256.
      </small>
    </div>
  );
  return (
    <main className="shell">
      {dragActive && (
        <div className="drop-overlay" role="status" aria-live="polite">
          <div className="drop-overlay-card">
            <span aria-hidden="true">↧</span>
            <strong>Dépose ton audio ici</strong>
            <small>L’import commence dès que tu lâches le fichier</small>
          </div>
        </div>
      )}
      <header className="top">
        <div className="brand">
          <span className="mark">۞</span>
          <div>
            <small>ATELIER DE REVUE</small>
            <h1>Artist Quran Review</h1>
          </div>
        </div>
        <div className="topnote">
          Hafs · Revue locale <span className="dot" /> Moteur expérimental
        </div>
      </header>
      {detail ? (
        <details className="new-trial">
          <summary>
            <span aria-hidden="true">＋</span> Nouvel essai
            <small>enregistrer une récitation ou importer un audio</small>
          </summary>
          {uploadPanel}
        </details>
      ) : (
        <section className="intro">
          <div>
            <p className="eyebrow">ÉCOUTER · VÉRIFIER · CORRIGER</p>
            <h2>
              Chaque récitation mérite
              <br />
              <em>une écoute attentive.</em>
            </h2>
            <p>
              Enregistre une récitation ou importe un audio, puis lance le
              moteur existant. Les hypothèses et les abstentions restent
              visibles comme telles.
            </p>
          </div>
          {uploadPanel}
        </section>
      )}
      {message && (
        <p className="notice error" role="alert">
          {message}
        </p>
      )}
      <div className="workspace">
        <aside className="library">
          <div className="section-head">
            <span>01 / SESSIONS</span>
            <button className="quiet" onClick={refreshList}>
              Actualiser
            </button>
          </div>
          {sessions.length === 0 ? (
            <p className="muted">Aucun essai local.</p>
          ) : (
            sessions.map((s) => (
              <button
                key={s.id}
                className={`session ${detail?.session.id === s.id ? "on" : ""}`}
                onClick={() => {
                  open(s.id)
                    .then(() =>
                      history.replaceState(null, "", `?session=${s.id}`),
                    )
                    .catch((e) => setMessage(e.message));
                }}
              >
                <span className="session-name">{s.name}</span>
                <span className="session-meta">
                  {new Date(s.created_at).toLocaleString("fr-FR")} ·{" "}
                  {states[s.state] || s.state}
                  {s.asr ? ` · ${engines[s.asr] || s.asr}` : ""}
                </span>
              </button>
            ))
          )}
        </aside>
        <section className="center">
          {!detail ? (
            <div className="empty">
              <span>۝</span>
              <h3>Le temps de l’écoute</h3>
              <p>
                Choisis un fichier pour ouvrir le lecteur, la carte arabe et les
                pistes synchronisées.
              </p>
            </div>
          ) : (
            <>
              <div className="section-head">
                <span>02 / ÉCOUTE</span>
                <span className="muted">{detail.session.name}</span>
              </div>
              <div className="statusbar">
                <span className={`state ${detail.session.state}`}>
                  {detail.session.state === "done"
                    ? "Résultat disponible"
                    : detail.session.state === "running"
                      ? `Analyse réelle en cours · ${formatTime(elapsed)}`
                      : detail.session.state === "ready"
                        ? "Prêt à analyser"
                        : detail.session.state === "failed"
                          ? "Moteur indisponible"
                          : "Annulé"}
                </span>
                {detail.session.asr && (
                  <span>
                    Moteur : {engines[detail.session.asr] || detail.session.asr}
                  </span>
                )}
                {detail.result?.riwaya && !detail.result.riwaya.verified && (
                  <span
                    className="riwaya-notice"
                    title={detail.result.riwaya.notice}
                  >
                    Riwaya{" "}
                    {detail.result.riwaya.assumed === "hafs"
                      ? "Hafs"
                      : detail.result.riwaya.assumed}{" "}
                    supposée · non vérifiée
                  </span>
                )}
                <span>SHA-256 {detail.session.audio_sha256.slice(0, 12)}…</span>
              </div>
              {detail.session.error && (
                <p className="notice error" role="alert">
                  {detail.session.error}
                </p>
              )}
              <div className="transport">
                <audio
                  key={detail.session.id}
                  ref={audio}
                  src={`/api/sessions/${detail.session.id}/audio`}
                  preload="metadata"
                  aria-label="Lecteur audio"
                  className="media-source"
                  onError={() =>
                    setMessage(
                      "Lecture impossible pour cet audio dans ce navigateur.",
                    )
                  }
                />
                <div className="player-heading">
                  <div>
                    <span className="player-eyebrow">ÉCOUTE DE LA SOURCE</span>
                    <strong title={detail.session.name}>
                      {detail.session.name}
                    </strong>
                  </div>
                  <span
                    className={`player-badge ${listening}`}
                    title={
                      listening === "ready"
                        ? "Audio décodé exactement comme le moteur l’a entendu (mono, 16 kHz) : les temps affichés et l’écoute coïncident à l’échantillon près."
                        : listening === "pending"
                          ? "Décodage de l’audio comme le moteur, une seule fois par session."
                          : "Fichier original : dans un MP3 à débit variable, le navigateur peut se positionner à plusieurs secondes de l’instant demandé."
                    }
                  >
                    {listening === "ready"
                      ? "ÉCOUTE = AUDIO DU MOTEUR"
                      : listening === "pending"
                        ? "PRÉPARATION DE L’ÉCOUTE…"
                        : "ORIGINAL · POSITION APPROXIMATIVE"}
                  </span>
                </div>
                <div className="player-main">
                  <button
                    className="play-toggle"
                    onClick={togglePlayback}
                    aria-label={
                      playing ? "Mettre en pause" : "Lancer la lecture"
                    }
                  >
                    {playing ? (
                      <span className="pause-icon" aria-hidden="true" />
                    ) : (
                      <span className="play-icon" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    className="seek-button"
                    onClick={() => {
                      if (audio.current)
                        audio.current.currentTime = Math.max(
                          0,
                          audio.current.currentTime - 5,
                        );
                    }}
                    aria-label="Reculer de 5 secondes"
                  >
                    −5<span>s</span>
                  </button>
                  <div className="player-progress">
                    <div className="player-times">
                      <span>{formatTime(time)}</span>
                      <span>{formatTime(duration)}</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max={duration || 1}
                      step="0.01"
                      value={Math.min(time, duration || 1)}
                      aria-label="Position de lecture"
                      style={{
                        background: `linear-gradient(to right, #d4e8bb 0%, #d4e8bb ${duration ? (time / duration) * 100 : 0}%, #4a6257 ${duration ? (time / duration) * 100 : 0}%, #4a6257 100%)`,
                      }}
                      onChange={(e) => {
                        if (audio.current)
                          audio.current.currentTime = Number(e.target.value);
                      }}
                    />
                  </div>
                  <button
                    className="seek-button"
                    onClick={() => {
                      if (audio.current)
                        audio.current.currentTime = Math.min(
                          duration,
                          audio.current.currentTime + 5,
                        );
                    }}
                    aria-label="Avancer de 5 secondes"
                  >
                    +5<span>s</span>
                  </button>
                  <label className="player-speed">
                    Vitesse{" "}
                    <select
                      value={speed}
                      onChange={(e) => setSpeed(Number(e.target.value))}
                    >
                      <option value="0.5">0,5×</option>
                      <option value="0.75">0,75×</option>
                      <option value="1">1×</option>
                      <option value="1.25">1,25×</option>
                      <option value="1.5">1,5×</option>
                    </select>
                  </label>
                </div>
                <div
                  ref={wave}
                  className="wave"
                  aria-label="Forme d’onde ; cliquer pour se déplacer dans l’audio"
                />
                <div className="transport-row player-tools">
                  <label>
                    Fenêtre visible{" "}
                    <select
                      value={span ?? ""}
                      onChange={(e) => {
                        const value = e.target.value
                          ? Number(e.target.value)
                          : null;
                        setSpan(value);
                      }}
                    >
                      {ZOOM_SPANS.map((z) => (
                        <option key={z.label} value={z.seconds ?? ""}>
                          {z.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={follow}
                      onChange={(e) => setFollow(e.target.checked)}
                    />{" "}
                    Suivre la lecture
                  </label>
                  <span className="muted">
                    {follow ? "Lecture suivie" : "Exploration libre"}
                  </span>
                  <label className="player-volume">
                    Volume{" "}
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={volume}
                      aria-label="Volume"
                      onChange={(e) => {
                        const value = Number(e.target.value);
                        setVolume(value);
                      }}
                    />
                  </label>
                </div>
              </div>
              <div className="timeline">
                <div className="section-head">
                  <span>04 / PISTES SYNCHRONISÉES</span>
                  <span className="muted">
                    {intervals.length} intervalles · repère commun{" "}
                    {formatTime(time)}
                  </span>
                </div>
                <div className="ruler">
                  <div className="track-names" aria-hidden="true">
                    <span>Moteur</span>
                    <span>Hypothèses</span>
                    <span>Revue</span>
                  </div>
                  <div
                    ref={lanes}
                    className="lanes-scroll"
                    onWheel={() => setFollow(false)}
                    onPointerDown={() => setFollow(false)}
                  >
                    <div
                      className="lanes"
                      style={{ width: `${laneWidthPercent(duration, span)}%` }}
                    >
                      <div
                        className="playhead"
                        style={{ left: `${percentAt(time, duration)}%` }}
                      />
                      {laneItems}
                      <div className="track">
                        {detail.review?.annotations
                          .filter((a) => a.end_s !== null)
                          .map((a) => (
                            <button
                              key={a.id}
                              className="track-item correction"
                              style={{
                                left: `${percentAt(a.start_s, duration)}%`,
                                width: `${percentAt(a.end_s! - a.start_s, duration)}%`,
                              }}
                              onClick={() => setDraft(a)}
                              title={a.description || labels[a.type]}
                            />
                          ))}
                      </div>
                      <div className="lane-ticks" aria-hidden="true">
                        {tickMarks}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              {detail.session.state === "ready" ||
              detail.session.state === "failed" ||
              detail.session.state === "cancelled" ? (
                <div className="run-controls">
                  <label className="engine-choice">
                    Moteur pour cette analyse
                    <select
                      value={asrChoice}
                      onChange={(event) =>
                        setAsrChoice(event.target.value as AsrChoice)
                      }
                    >
                      <option value="fastconformer">
                        FastConformer · actuel
                      </option>
                      <option value="whisper">Whisper · challenger</option>
                      <option value="muno-streaming">
                        Muno Streaming · ONNX quantifié
                      </option>
                    </select>
                  </label>
                  <button
                    className="primary run"
                    disabled={busy}
                    onClick={() => action("POST")}
                  >
                    Lancer le vrai moteur Python ↗
                  </button>
                </div>
              ) : detail.session.state === "running" ? (
                <button
                  className="outline run"
                  disabled={busy}
                  onClick={() => action("DELETE")}
                >
                  Arrêter le traitement
                </button>
              ) : null}
              <div ref={card} className="verse-card">
                <div className="card-top">
                  <span>03 / PASSAGE ACTIF</span>
                  <div>
                    <button
                      onClick={() => setFontSize((v) => Math.max(28, v - 4))}
                      aria-label="Réduire le texte arabe"
                    >
                      A−
                    </button>
                    <button
                      onClick={() => setFontSize((v) => Math.min(72, v + 4))}
                      aria-label="Agrandir le texte arabe"
                    >
                      A+
                    </button>
                  </div>
                </div>
                {shown && shown.kind === "verse" ? (
                  <>
                    <div className="badges">
                      <span>
                        {shown.status === "inferred"
                          ? "Hypothèse · non entendue"
                          : labels[shown.status]}
                      </span>
                      {shown.partial && <span>Passage partiel</span>}
                      {shown.repetition && <span>Répétition</span>}
                      {shown.time_interpolated && <span>Temps interpolé</span>}
                    </div>
                    <div className="ref-row">
                      <p className="ref">
                        {shown.status === "uncertain"
                          ? "Identification ambiguë"
                          : shown.ref}{" "}
                        ·{" "}
                        {shown.t
                          ? `${formatTime(shown.t[0])} – ${formatTime(shown.t[1])}`
                          : "Sans temps"}
                      </p>
                      {shown.t && (
                        <button
                          className="outline play-segment"
                          onClick={() => playSegment(shown)}
                        >
                          <span className="play-icon" aria-hidden="true" />{" "}
                          Écouter ce passage
                        </button>
                      )}
                    </div>
                    {shown.text ? (
                      <p
                        className="arabic"
                        lang="ar"
                        dir="rtl"
                        style={{ fontSize }}
                      >
                        {shown.text}
                      </p>
                    ) : (
                      <p className="arabic placeholder" lang="fr">
                        {shown.status === "uncertain"
                          ? `Références candidates : ${shown.candidates.join(" · ") || "aucune"}`
                          : "Texte non inclus dans ce résultat"}
                      </p>
                    )}
                    {translation && shown.translation && (
                      <div className="translation">
                        <p>{shown.translation.text}</p>
                        <small>
                          {shown.partial
                            ? "Traduction du verset entier · "
                            : ""}
                          {shown.translation.attribution} ·{" "}
                          {shown.translation.translation_id} · source{" "}
                          {shown.translation.version}
                        </small>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="card-empty">
                    <h3>Aucun verset localisé à cet instant</h3>
                    <p>
                      {shown
                        ? intervalLabel(shown)
                        : active.length
                          ? active.map(intervalLabel).join(" · ")
                          : "Lis un passage ou sélectionne un segment dans la liste."}
                    </p>
                  </div>
                )}
                <label className="translation-toggle">
                  <input
                    type="checkbox"
                    checked={translation}
                    onChange={(e) => setTranslation(e.target.checked)}
                  />{" "}
                  Afficher la traduction
                </label>
              </div>
              <div className="segments">
                <div className="section-head">
                  <span>05 / INTERVALLES</span>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    aria-label="Filtrer les intervalles"
                  >
                    <option value="all">Tous</option>
                    <option value="verse">Versets</option>
                    <option value="uncertain">À revoir</option>
                    <option value="non_quran">Formules</option>
                    <option value="abstention">Abstentions</option>
                  </select>
                </div>
                <div
                  ref={segmentList}
                  className="segment-list"
                  onWheel={() => setFollow(false)}
                >
                  {visible.length === 0 ? (
                    <p className="muted">Aucun intervalle à afficher.</p>
                  ) : (
                    visible.map(({ item, index }) => (
                      <button
                        data-index={index}
                        key={index}
                        className={`segment ${selected === index || (selected === null && currentIndex === index) ? "active" : ""}`}
                        onClick={() => seek(index)}
                      >
                        <span className="segment-time">
                          {item.t ? formatTime(item.t[0]) : "Sans temps"}
                        </span>
                        <span className="segment-title">
                          {intervalLabel(item)}
                        </span>
                        <span className="segment-state">
                          {item.kind === "verse"
                            ? labels[item.status]
                            : labels[item.kind]}
                        </span>
                      </button>
                    ))
                  )}
                  {intervals.some((i) => i.t === null) && (
                    <p className="muted">
                      Les éléments « Sans temps » ne déplacent pas le lecteur.
                    </p>
                  )}
                </div>
              </div>
              <details className="diagnostics">
                <summary>Détails du moteur et avertissements</summary>
                <p>
                  ASR : {detail.result?.engine.asr || "en attente"} ·
                  Segmentation :{" "}
                  {detail.result?.engine.segmenter || "en attente"}
                </p>
                <p>
                  Ces scores proviennent du moteur ; ils ne sont pas des
                  probabilités de justesse calibrées.
                </p>
                {detail.result?.warnings.map((w, i) => (
                  <p key={i}>Avertissement : {w}</p>
                ))}
                {selected !== null && intervals[selected] && (
                  <pre>{JSON.stringify(intervals[selected], null, 2)}</pre>
                )}
              </details>
            </>
          )}
        </section>
        <aside className="review">
          <div className="section-head">
            <span>06 / REVUE HUMAINE</span>
          </div>
          {!detail ? (
            <p className="muted">La revue s’ouvre avec un audio.</p>
          ) : (
            <>
              <p className="review-intro">
                Note ce qui est faux. Un signalement ne devient pas une vérité
                terrain complète.
              </p>
              <div className="review-actions">
                <button
                  className="primary"
                  onClick={() => startAnnotation("point")}
                >
                  + Signaler ici
                </button>
                <button
                  className="outline"
                  onClick={() => startAnnotation("range")}
                >
                  + Sélectionner une plage
                </button>
              </div>
              {draft && (
                <div className="editor">
                  <div className="section-head">
                    <span>
                      {draft.status === "confirmed"
                        ? "Signalement confirmé"
                        : "Brouillon"}
                    </span>
                    <button className="quiet" onClick={() => setDraft(null)}>
                      Fermer
                    </button>
                  </div>
                  <label>
                    Type d’erreur
                    <select
                      value={draft.type}
                      onChange={(e) =>
                        patchDraft({
                          type: e.target.value as Annotation["type"],
                        })
                      }
                    >
                      {Object.entries(labels)
                        .filter(([k]) =>
                          [
                            "wrong_verse",
                            "missing_verse",
                            "repetition",
                            "timing",
                            "other",
                          ].includes(k),
                        )
                        .map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className="form-row">
                    <label>
                      Début (s)
                      <input
                        type="number"
                        step="0.001"
                        min="0"
                        value={draft.start_s}
                        onChange={(e) =>
                          patchDraft({ start_s: Number(e.target.value) })
                        }
                      />
                    </label>
                    {draft.mode === "range" && (
                      <label>
                        Fin (s)
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          value={draft.end_s ?? ""}
                          onChange={(e) =>
                            patchDraft({ end_s: Number(e.target.value) })
                          }
                        />
                      </label>
                    )}
                  </div>
                  <label>
                    Description
                    <textarea
                      value={draft.description}
                      onChange={(e) =>
                        patchDraft({ description: e.target.value })
                      }
                      placeholder="Qu’as-tu entendu ? Que faut-il corriger ?"
                    />
                  </label>
                  <label>
                    Référence attendue{" "}
                    <span className="optional">facultatif</span>
                    <input
                      value={draft.expected_ref || ""}
                      onChange={(e) =>
                        patchDraft({ expected_ref: e.target.value || null })
                      }
                      placeholder="ex. 2:255"
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={loop}
                      onChange={(e) => {
                        setLoop(e.target.checked);
                        if (e.target.checked && audio.current) {
                          audio.current.currentTime =
                            draft.mode === "range"
                              ? draft.start_s
                              : Math.max(0, draft.start_s - 2);
                          audio.current.play();
                        }
                      }}
                    />{" "}
                    Écouter en boucle{" "}
                    {draft.mode === "point"
                      ? "(± 2 s, écoute seulement)"
                      : "la plage"}
                  </label>
                  <button
                    className="primary"
                    onClick={() => {
                      if (!draft.description.trim()) {
                        setMessage("Décris le signalement avant confirmation.");
                        return;
                      }
                      patchDraft({ status: "confirmed" });
                    }}
                  >
                    Confirmer après écoute
                  </button>
                  <button className="quiet" onClick={removeDraft}>
                    Annuler ce signalement
                  </button>
                  <p
                    className={`save ${saveState.startsWith("Échec") ? "error" : ""}`}
                  >
                    {saveState || "Brouillon local"}
                  </p>
                </div>
              )}
              <ValidationPanel
                sessionId={detail.session.id}
                ready={
                  detail.session.state === "done" && Boolean(detail.result)
                }
                audio={audio}
                time={time}
                duration={duration}
              />
              <div className="review-list">
                <h3>Signalements ({detail.review?.annotations.length || 0})</h3>
                {detail.review?.annotations.map((a) => (
                  <button key={a.id} onClick={() => setDraft(a)}>
                    <span>
                      {formatTime(a.start_s)}{" "}
                      {a.mode === "range" && a.end_s !== null
                        ? `– ${formatTime(a.end_s)}`
                        : "· point"}
                    </span>
                    <strong>{labels[a.type]}</strong>
                    <small>
                      {a.status === "confirmed" ? "Confirmé" : "Brouillon"}
                    </small>
                  </button>
                ))}
              </div>
              <a
                className="export"
                href={`/api/sessions/${detail.session.id}/bundle`}
                download
              >
                Télécharger le pack complet ZIP ↗
              </a>
              <a
                className="audio-download"
                href={`/api/sessions/${detail.session.id}/export`}
                download
              >
                Exporter le bilan JSON
              </a>
              <p className="fine">
                Le ZIP contient audio, prédiction et révisions avec leurs
                empreintes. Aucun envoi cloud automatique. Métriques
                indisponibles pour une revue partielle.
              </p>
            </>
          )}
        </aside>
      </div>
      <footer>
        Texte coranique : Tanzil Project ·{" "}
        <a href="https://tanzil.net" target="_blank" rel="noreferrer">
          tanzil.net
        </a>
        . Traductions : QuranEnc, provenance affichée par passage. Aucune
        reconnaissance simulée.
      </footer>
    </main>
  );
}
