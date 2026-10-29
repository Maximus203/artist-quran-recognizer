"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EXPORT_VIDEO_CONFIG } from "@/lib/export-video-config";
import {
  fitView,
  formatClock,
  formatTick,
  keyAction,
  moveRange,
  neighbourTarget,
  panView,
  pinchView,
  rulerStep,
  setEdge,
  snapToTarget,
  spokenTime,
  timeToX,
  xToTime,
  zoomView,
  type Edge,
  type View,
} from "@/lib/export-timeline";
import { verseAt, type PlanRange } from "@/lib/export-video-plan";
import type { Silence, SuggestTiming } from "@/lib/export-video-suggest";
import { formatDurationFr } from "@/lib/format";
import { useStoreValue } from "../hooks";
import type { PlayerState } from "../use-player";
import type { Store } from "@/lib/mini-store";
import { XIcon } from "./export-icons";

/**
 * La frise d'export (« le rouleau ») : vue d'ensemble de TOUT l'audio avec sa fenêtre, loupe
 * (règle, imagettes si vidéo, rangée des passages codée par motif, onde), plages posées en DOM
 * (cadre d'encre, souffle hachuré, deux poignées 44 px tournées vers l'extérieur). Toute la
 * géométrie vit dans `lib/export-timeline.ts` ; ce composant lit les gestes et dessine.
 */
const TL = EXPORT_VIDEO_CONFIG.timeline;
const KB = EXPORT_VIDEO_CONFIG.keyboard;
const RULER = 18;
const LANE = 22;
const THUMB = 48;
const MINI_H = 34;
/** Cible tactile d'une poignée (= --hit). */
const HIT_PX = 44;

export type Thumbs = { image: HTMLImageElement; count: number; every: number };
type Clock = Store<PlayerState>;

function Playhead({
  clock,
  view,
  width,
}: {
  clock: Clock;
  view: View;
  width: number;
}) {
  const time = useStoreValue(clock, (s) => s.time);
  if (time < view.a || time > view.b) return null;
  return (
    <i className="xr-playhead" style={{ left: timeToX(time, view, width) }} />
  );
}
type Peaks = { per_second: number; duration: number; peaks: readonly number[] };

type Colors = Record<
  | "accent"
  | "warn"
  | "slate"
  | "text3"
  | "wave"
  | "played"
  | "ink"
  | "sub"
  | "ok",
  string
>;

function readColors(probe: HTMLElement): Colors {
  const get = (name: string) => {
    probe.style.color = `var(${name})`;
    return getComputedStyle(probe).color;
  };
  return {
    accent: get("--accent"),
    warn: get("--warn-edge"),
    slate: get("--slate-edge"),
    text3: get("--text-3"),
    wave: get("--wave"),
    played: get("--wave-played"),
    ink: get("--action-bg"),
    sub: get("--border-subtle"),
    ok: get("--ok"),
  };
}
const alpha = (rgb: string, a: number): string =>
  rgb.startsWith("rgba")
    ? rgb
    : rgb.replace("rgb(", "rgba(").replace(")", `, ${a})`);

function fit(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = `${h}px`;
  const g = canvas.getContext("2d");
  g?.setTransform(dpr, 0, 0, dpr, 0, 0);
  return g;
}
function pattern(
  g: CanvasRenderingContext2D,
  kind: "hatch" | "dots",
  color: string,
) {
  const p = document.createElement("canvas");
  p.width = p.height = 6;
  const q = p.getContext("2d");
  if (!q) return color;
  q.strokeStyle = color;
  q.fillStyle = color;
  q.lineWidth = 1.2;
  q.beginPath();
  if (kind === "hatch") {
    q.moveTo(0, 6);
    q.lineTo(6, 0);
    q.stroke();
  } else {
    q.arc(3, 3, 1.1, 0, 7);
    q.fill();
  }
  return g.createPattern(p, "repeat") ?? color;
}

const maxPeak = (peaks: Peaks, t0: number, t1: number): number => {
  const v = peaks.peaks;
  let m = 0;
  const k1 = Math.min(v.length - 1, Math.ceil(t1 * peaks.per_second));
  for (let k = Math.max(0, Math.floor(t0 * peaks.per_second)); k <= k1; k++)
    if (v[k] > m) m = v[k];
  return m;
};

type Drag = {
  id: number;
  kind: Edge | "move";
  pointer: number;
  x0: number;
  start0: number;
  end0: number;
  scale: number;
  moved: boolean;
  timer: number;
  lastX: number;
};
type Pan = {
  x0: number;
  view0: View;
  moved: boolean;
  pinch: { distance: number; view: View; mid: number } | null;
};

export function RangeTimeline({
  duration,
  peaks,
  intervals,
  ranges,
  selectedId,
  view,
  onView,
  onSelect,
  onChange,
  onGestureEnd,
  onRemove,
  onAddVerse,
  targets,
  silences,
  magnet,
  thumbs,
  playing,
  clock,
  onTogglePlay,
  announce,
}: {
  duration: number;
  peaks: Peaks | null;
  intervals: readonly SuggestTiming[];
  ranges: readonly PlanRange[];
  selectedId: number | null;
  view: View;
  onView: (view: View) => void;
  onSelect: (id: number) => void;
  /** Bords modifiés (pendant le geste). */
  onChange: (id: number, next: { start: number; end: number }) => void;
  /** Fin d'un geste sur une plage : `at` = l'instant à montrer dans l'aperçu. */
  onGestureEnd: (id: number, at: number) => void;
  onRemove: (id: number) => void;
  onAddVerse: (t: number) => void;
  targets: readonly number[];
  silences: readonly Silence[];
  magnet: boolean;
  thumbs: Thumbs | null;
  playing: boolean;
  /** Position de lecture (magasin du lecteur) : seule la tête de lecture la lit à chaque image. */
  clock: Clock;
  onTogglePlay: () => void;
  announce: (message: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const miniBoxRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0);
  const [miniWidth, setMiniWidth] = useState(0);
  const [precision, setPrecision] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [pop, setPop] = useState<{ t: number; x: number } | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  const drag = useRef<Drag | null>(null);
  const pan = useRef<Pan | null>(null);
  const pointers = useRef(new Map<number, number>());
  const miniDrag = useRef<{ x0: number; view0: View } | null>(null);
  const isVideo = thumbs !== null;
  const waveH = width > 0 && width < 560 ? 92 : 112;
  const topWave = RULER + (isVideo ? THUMB + 4 : 0) + LANE + 6;
  const fullH = topWave + waveH + 6;
  const span = view.b - view.a;
  const X = useCallback((t: number) => timeToX(t, view, width), [view, width]);
  const T = useCallback((x: number) => xToTime(x, view, width), [view, width]);

  // Largeurs suivies (le dessin se refait au redimensionnement).
  useEffect(() => {
    const stage = stageRef.current;
    const mini = miniBoxRef.current;
    if (!stage || !mini) return;
    const observer = new ResizeObserver(() => {
      setWidth(stage.clientWidth);
      setMiniWidth(mini.clientWidth);
    });
    observer.observe(stage);
    observer.observe(mini);
    return () => observer.disconnect();
  }, []);

  // Thème clair/sombre : les couleurs du canvas viennent des tokens, relues au changement.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setThemeTick((n) => n + 1);
    media.addEventListener("change", bump);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => {
      media.removeEventListener("change", bump);
      observer.disconnect();
    };
  }, []);

  const inRanges = useMemo(
    () => (t: number) => ranges.some((r) => t >= r.start && t <= r.end),
    [ranges],
  );

  // Loupe : règle, imagettes, passages, onde, silences.
  useEffect(() => {
    const canvas = mainRef.current;
    const probe = probeRef.current;
    if (!canvas || !probe || width === 0) return;
    const g = fit(canvas, width, fullH);
    if (!g) return;
    const C = readColors(probe);
    g.clearRect(0, 0, width, fullH);
    const step = rulerStep(span, width, TL.rulerTargetPx);
    g.font = "600 11px 'Atkinson Hyperlegible Mono', monospace";
    g.fillStyle = C.text3;
    g.strokeStyle = C.sub;
    g.lineWidth = 1;
    for (let t = Math.ceil(view.a / step) * step; t <= view.b; t += step) {
      const x = Math.round(X(t)) + 0.5;
      g.beginPath();
      g.moveTo(x, RULER - 5);
      g.lineTo(x, fullH);
      g.stroke();
      const label = formatTick(t);
      if (x + 4 + g.measureText(label).width < width)
        g.fillText(label, x + 3, 12);
    }
    let y = RULER;
    if (thumbs) {
      const tileW = thumbs.image.naturalWidth / thumbs.count;
      const tileH = thumbs.image.naturalHeight;
      for (let x = 0; x < width; x += TL.thumbEveryPx) {
        const t = T(x + TL.thumbEveryPx / 2);
        const i = Math.min(
          thumbs.count - 1,
          Math.max(0, Math.floor(t / thumbs.every)),
        );
        const w = TL.thumbEveryPx - 1;
        const sw = Math.min(tileW, tileH * (w / THUMB));
        if (tileW > 0)
          g.drawImage(
            thumbs.image,
            i * tileW + (tileW - sw) / 2,
            0,
            sw,
            tileH,
            x,
            y,
            w,
            THUMB,
          );
      }
      y += THUMB + 4;
    }
    const hatch = pattern(g, "hatch", C.accent);
    const dots = pattern(g, "dots", C.warn);
    g.font = "700 10px 'Atkinson Hyperlegible Mono', monospace";
    g.textBaseline = "middle";
    let n = 0;
    for (const item of intervals) {
      if (!item.t) continue;
      const [s, e] = item.t;
      if (item.kind === "verse") n += 1;
      if (e < view.a || s > view.b) continue;
      const x0 = X(s);
      const w = Math.max(2, X(e) - x0);
      if (item.kind !== "verse") {
        g.fillStyle = alpha(C.slate, 0.22);
        g.fillRect(x0, y + 4, w, LANE - 8);
        g.strokeStyle = C.slate;
        g.beginPath();
        g.moveTo(x0, y + 4.5);
        g.lineTo(x0 + w, y + 4.5);
        g.moveTo(x0, y + LANE - 4.5);
        g.lineTo(x0 + w, y + LANE - 4.5);
        g.stroke();
        continue;
      }
      const status = item.status ?? "recognized";
      const color = status === "uncertain" ? C.warn : C.accent;
      g.fillStyle =
        status === "recognized"
          ? alpha(C.accent, 0.26)
          : status === "inferred"
            ? hatch
            : dots;
      g.fillRect(x0, y, w, LANE);
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.setLineDash(
        status === "uncertain" ? [3, 2] : status === "inferred" ? [6, 3] : [],
      );
      g.strokeRect(x0 + 0.75, y + 0.75, w - 1.5, LANE - 1.5);
      g.setLineDash([]);
      if (w > 22) {
        g.fillStyle = color;
        g.fillText(String(n), x0 + 5, y + LANE / 2 + 1);
      }
    }
    g.textBaseline = "alphabetic";
    y = topWave;
    if (peaks) {
      const mid = y + waveH / 2;
      const amp = waveH / 2 - 2;
      for (let x = 0; x < width; x += 2) {
        const t0 = T(x);
        const m = maxPeak(peaks, t0, T(x + 2));
        g.fillStyle = inRanges(t0) ? C.played : C.wave;
        const h = Math.max(1, m * amp);
        g.fillRect(x, mid - h, 1.4, h * 2);
      }
    }
    if (magnet && span < TL.silenceMarksMaxSpan) {
      g.fillStyle = C.ok;
      for (const s of silences) {
        if (s.end < view.a || s.start > view.b) continue;
        g.fillRect(
          X(s.start),
          fullH - 4,
          Math.max(2, X(s.end) - X(s.start)),
          2,
        );
      }
    }
  }, [
    X,
    T,
    view,
    span,
    width,
    fullH,
    topWave,
    waveH,
    thumbs,
    intervals,
    peaks,
    inRanges,
    magnet,
    silences,
    themeTick,
  ]);

  // Vue d'ensemble : onde de tout l'audio (maxima par pixel, calculés une fois par largeur).
  const miniColumns = useMemo(() => {
    if (!peaks || miniWidth === 0) return null;
    const out = new Float32Array(miniWidth);
    for (let px = 0; px < miniWidth; px++)
      out[px] = maxPeak(
        peaks,
        (px / miniWidth) * duration,
        ((px + 1) / miniWidth) * duration,
      );
    return out;
  }, [peaks, miniWidth, duration]);
  useEffect(() => {
    const canvas = miniRef.current;
    const probe = probeRef.current;
    if (!canvas || !probe || miniWidth === 0) return;
    const g = fit(canvas, miniWidth, MINI_H);
    if (!g) return;
    canvas.style.height = "100%";
    const C = readColors(probe);
    const x = (t: number) => (t / duration) * miniWidth;
    if (miniColumns)
      for (let px = 0; px < miniWidth; px++) {
        g.fillStyle = C.wave;
        g.fillRect(
          px,
          MINI_H / 2 - miniColumns[px] * 11,
          1,
          miniColumns[px] * 22 + 0.5,
        );
      }
    for (const r of ranges) {
      g.fillStyle = r.id === selectedId ? C.ink : C.text3;
      g.fillRect(x(r.start), MINI_H - 5, Math.max(2, x(r.end) - x(r.start)), 4);
    }
    for (const item of intervals)
      if (
        item.kind === "verse" &&
        item.t &&
        item.status &&
        item.status !== "recognized"
      ) {
        g.fillStyle = item.status === "uncertain" ? C.warn : C.accent;
        g.fillRect(x(item.t[0]) - 1, 1, 3, 5);
      }
  }, [
    miniColumns,
    miniWidth,
    ranges,
    selectedId,
    intervals,
    duration,
    themeTick,
  ]);

  // Molette : Ctrl/⌘ = zoom autour du pointeur ; horizontale ou Maj = déplacement ; verticale = la page défile.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      const rect = stage.getBoundingClientRect();
      const at = xToTime(event.clientX - rect.left, view, rect.width);
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        onView(
          zoomView(
            view,
            event.deltaY > 0 ? TL.wheelZoomOut : TL.wheelZoomIn,
            at,
            duration,
            TL.minSpanSeconds,
          ),
        );
      } else if (
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ||
        event.shiftKey
      ) {
        event.preventDefault();
        const d = event.shiftKey ? event.deltaY : event.deltaX;
        onView(panView(view, (d / rect.width) * (view.b - view.a), duration));
      }
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [view, duration, onView]);

  const selected = ranges.find((r) => r.id === selectedId) ?? null;
  const selectedIndex = selected ? ranges.indexOf(selected) : -1;
  const localX = (clientX: number) =>
    clientX - (stageRef.current?.getBoundingClientRect().left ?? 0);

  const applyEdge = (
    range: PlanRange,
    kind: Edge,
    value: number,
    snap: boolean,
  ) => {
    let v = value;
    if (snap && magnet) {
      const s = snapToTarget(v, targets, view, width, TL.snapPx);
      if (s !== null) v = s;
    }
    return setEdge(range, kind, v, duration);
  };

  // --- gestes sur une plage (poignées, corps) ---------------------------------------------------
  const onRangeDown = (
    event: ReactPointerEvent<HTMLElement>,
    range: PlanRange,
    kind: Edge | "move",
  ) => {
    event.stopPropagation();
    event.preventDefault();
    setPop(null);
    pointers.current.set(event.pointerId, event.clientX);
    // Deuxième doigt pendant un geste sur une plage : c'est un pincement, la plage revient où elle était.
    const current = drag.current;
    if (current && pointers.current.size === 2) {
      window.clearTimeout(current.timer);
      onChange(current.id, { start: current.start0, end: current.end0 });
      drag.current = null;
      setPrecision(false);
      setDragging(null);
      const xs = [...pointers.current.values()];
      pan.current = {
        x0: xs[0],
        view0: view,
        moved: true,
        pinch: {
          distance: Math.abs(xs[0] - xs[1]),
          view,
          mid: T(localX((xs[0] + xs[1]) / 2)),
        },
      };
      return;
    }
    if (range.id !== selectedId) {
      onSelect(range.id);
      if (kind === "move") return;
    }
    try {
      stageRef.current?.setPointerCapture(event.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    const state: Drag = {
      id: range.id,
      kind,
      pointer: event.pointerId,
      x0: event.clientX,
      lastX: event.clientX,
      start0: range.start,
      end0: range.end,
      scale: 1,
      moved: false,
      timer: 0,
    };
    // Appui long sans bouger : mode précision (le doigt couvre la poignée, on démultiplie le geste).
    if (kind !== "move")
      state.timer = window.setTimeout(() => {
        const d = drag.current;
        if (!d || d.moved) return;
        const current = ranges.find((r) => r.id === d.id);
        d.scale = TL.precisionScale;
        d.x0 = d.lastX;
        d.start0 = current?.start ?? d.start0;
        d.end0 = current?.end ?? d.end0;
        setPrecision(true);
        navigator.vibrate?.(10);
      }, TL.longPressMs);
    drag.current = state;
    setDragging(kind === "move" ? null : `${range.id}-${kind}`);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d && event.pointerId === d.pointer) {
      d.lastX = event.clientX;
      const dx = event.clientX - d.x0;
      if (Math.abs(dx) > TL.moveThresholdPx) d.moved = true;
      if (!d.moved && d.scale === 1) return;
      const dt = (dx / Math.max(1, width)) * span * d.scale;
      const range = ranges.find((r) => r.id === d.id);
      if (!range) return;
      const base = { ...range, start: d.start0, end: d.end0 };
      onChange(
        d.id,
        d.kind === "move"
          ? moveRange(base, dt, duration)
          : applyEdge(
              base,
              d.kind,
              (d.kind === "start" ? d.start0 : d.end0) + dt,
              d.scale === 1,
            ),
      );
      return;
    }
    const p = pan.current;
    if (!p || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, event.clientX);
    if (p.pinch && pointers.current.size === 2) {
      const xs = [...pointers.current.values()];
      onView(
        pinchView(
          p.pinch.view,
          p.pinch.distance,
          Math.abs(xs[0] - xs[1]),
          p.pinch.mid,
          duration,
          TL.minSpanSeconds,
        ),
      );
      return;
    }
    const dx = event.clientX - p.x0;
    if (Math.abs(dx) > TL.panThresholdPx) p.moved = true;
    if (p.moved)
      onView(panView(p.view0, -(dx / Math.max(1, width)) * span, duration));
  };

  const onStageDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest(".xr-plage .body, .xr-grip"))
      return;
    pointers.current.set(event.pointerId, event.clientX);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* déjà relâché */
    }
    if (pointers.current.size === 2) {
      const xs = [...pointers.current.values()];
      pan.current = {
        x0: xs[0],
        view0: view,
        moved: true,
        pinch: {
          distance: Math.abs(xs[0] - xs[1]),
          view,
          mid: T(localX((xs[0] + xs[1]) / 2)),
        },
      };
      return;
    }
    pan.current = { x0: event.clientX, view0: view, moved: false, pinch: null };
  };

  const openPopAt = (clientX: number) => {
    const x = localX(clientX);
    const t = T(x);
    const verse = verseAt(intervals, t, TL.verseHitSeconds);
    setPop(verse ? { t, x } : null);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d && event.pointerId === d.pointer) {
      pointers.current.delete(event.pointerId);
      window.clearTimeout(d.timer);
      drag.current = null;
      setPrecision(false);
      setDragging(null);
      const range = ranges.find((r) => r.id === d.id);
      // Toucher une plage sans la déplacer = toucher le passage dessous (proposer « Ajouter ce verset »).
      if (d.kind === "move" && !d.moved) {
        if (event.type === "pointerup") openPopAt(event.clientX);
        return;
      }
      if (!range || (!d.moved && d.scale === 1)) return;
      const at =
        d.kind === "end"
          ? range.end
          : d.kind === "start"
            ? range.start
            : range.start;
      onGestureEnd(range.id, at);
      announce(
        d.kind === "move"
          ? `Plage déplacée : ${spokenTime(range.start)} à ${spokenTime(range.end)}.`
          : `${d.kind === "start" ? "Début" : "Fin"} : ${spokenTime(at)}.`,
      );
      return;
    }
    pointers.current.delete(event.pointerId);
    const p = pan.current;
    if (!p) return;
    if (!p.moved && !p.pinch && event.type === "pointerup")
      openPopAt(event.clientX);
    if (pointers.current.size === 0) pan.current = null;
  };

  const onGripKey = (
    event: React.KeyboardEvent<HTMLElement>,
    range: PlanRange,
    kind: Edge,
  ) => {
    const action = keyAction(event.key, {
      shift: event.shiftKey,
      alt: event.altKey,
    });
    if (!action) return;
    event.preventDefault();
    if (action.kind === "play") return onTogglePlay();
    if (action.kind === "remove") {
      onRemove(range.id);
      // Le focus ne se perd pas : il passe à la même poignée de la plage voisine (désormais choisie),
      // sinon au curseur de la vue d'ensemble.
      window.setTimeout(() => {
        const root = stageRef.current?.parentElement;
        const next =
          root?.querySelector<HTMLElement>(
            `.xr-plage[data-selected="true"] .xr-grip--${kind}`,
          ) ?? root?.querySelector<HTMLElement>(".xr-view");
        next?.focus();
      }, 60);
      return;
    }
    const current = kind === "start" ? range.start : range.end;
    const value =
      action.kind === "delta"
        ? current + action.seconds
        : neighbourTarget(targets, current, action.direction);
    if (value === null) return;
    const next = setEdge(range, kind, value, duration);
    onChange(range.id, next);
    const at = kind === "start" ? next.start : next.end;
    onGestureEnd(range.id, at);
    // La loupe suit la poignée si elle en sort.
    if (at < view.a || at > view.b)
      onView(panView(view, at - (view.a + view.b) / 2, duration));
    announce(`${kind === "start" ? "Début" : "Fin"} : ${spokenTime(at)}.`);
  };

  // --- vue d'ensemble -------------------------------------------------------------------------
  const onMiniDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const t = ((event.clientX - rect.left) / rect.width) * duration;
    let start = view;
    if (!(event.target as HTMLElement).classList.contains("xr-view")) {
      start = panView(view, t - (view.a + view.b) / 2, duration);
      onView(start);
    }
    miniDrag.current = { x0: event.clientX, view0: start };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* déjà relâché */
    }
  };
  const onMiniMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const m = miniDrag.current;
    if (!m) return;
    const d =
      ((event.clientX - m.x0) / event.currentTarget.clientWidth) * duration;
    onView(panView(m.view0, d, duration));
  };
  const onViewKey = (event: React.KeyboardEvent<HTMLElement>) => {
    const d = (event.shiftKey ? KB.viewShiftStep : KB.viewStep) * span;
    const center = (view.a + view.b) / 2;
    const zoom = (f: number) =>
      onView(zoomView(view, f, center, duration, TL.minSpanSeconds));
    if (event.key === "ArrowLeft") onView(panView(view, -d, duration));
    else if (event.key === "ArrowRight") onView(panView(view, d, duration));
    else if (event.key === "+" || event.key === "=") zoom(KB.zoomIn);
    else if (event.key === "-") zoom(KB.zoomOut);
    else return;
    event.preventDefault();
  };

  const zoomBy = (factor: number) =>
    onView(
      zoomView(
        view,
        factor,
        (view.a + view.b) / 2,
        duration,
        TL.minSpanSeconds,
      ),
    );
  const popVerse = pop ? verseAt(intervals, pop.t, TL.verseHitSeconds) : null;
  const popIndex = popVerse
    ? intervals.filter((i) => i.kind === "verse").indexOf(popVerse) + 1
    : 0;
  const popWidth = 280;

  return (
    <div className="xr-frise" data-precision={precision || undefined}>
      <span ref={probeRef} hidden />
      <div
        ref={miniBoxRef}
        className="xr-mini"
        onPointerDown={onMiniDown}
        onPointerMove={onMiniMove}
        onPointerUp={() => (miniDrag.current = null)}
        onPointerCancel={() => (miniDrag.current = null)}
      >
        <canvas ref={miniRef} aria-hidden="true" />
        <div
          className="xr-view"
          role="slider"
          tabIndex={0}
          aria-label="Portion de l’audio affichée dans la loupe"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(view.a)}
          aria-valuetext={`De ${spokenTime(view.a)} à ${spokenTime(view.b)}`}
          data-testid="timeline-window"
          style={{
            left: `${(view.a / duration) * 100}%`,
            width: `${(span / duration) * 100}%`,
          }}
          onKeyDown={onViewKey}
        />
      </div>

      <div
        ref={stageRef}
        className="xr-stage"
        data-testid="timeline-stage"
        onPointerDown={onStageDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest(".xr-plage .body")) return;
          const t = T(localX(event.clientX));
          const verse = verseAt(intervals, t, TL.verseHitSeconds);
          if (verse && verse.status !== "uncertain") onAddVerse(t);
        }}
      >
        <canvas
          ref={mainRef}
          role="img"
          aria-label={`Loupe sur l’audio, de ${spokenTime(view.a)} à ${spokenTime(view.b)} : règle, passages et forme d’onde`}
        />
        <div className="xr-overlay" style={{ top: RULER }}>
          {ranges.map((range, index) => {
            if (range.end < view.a || range.start > view.b || width === 0)
              return null;
            const x0 = X(range.start);
            const x1 = X(range.end);
            const isSel = range.id === selectedId;
            const verses = intervals.filter(
              (i) =>
                i.kind === "verse" &&
                i.t &&
                i.t[1] > range.start &&
                i.t[0] < range.end,
            );
            const voiceStart = verses.length
              ? Math.min(...verses.map((v) => v.t![0]))
              : null;
            const voiceEnd = verses.length
              ? Math.max(...verses.map((v) => v.t![1]))
              : null;
            const breathL =
              voiceStart !== null ? Math.max(0, X(voiceStart) - x0) : 0;
            const breathR =
              voiceEnd !== null ? Math.max(0, x1 - X(voiceEnd)) : 0;
            return (
              <div
                key={range.id}
                className="xr-plage"
                data-selected={isSel}
                style={{ left: x0, width: Math.max(2, x1 - x0) }}
              >
                <div
                  className="body"
                  title={range.name || `Plage ${index + 1}`}
                  onPointerDown={(e) => onRangeDown(e, range, "move")}
                />
                {breathL > 0.5 && breathL < x1 - x0 ? (
                  <i className="breath" style={{ left: 0, width: breathL }} />
                ) : null}
                {breathR > 0.5 && breathR < x1 - x0 ? (
                  <i className="breath" style={{ right: 0, width: breathR }} />
                ) : null}
                <span className="tag">{index + 1}</span>
                {(["start", "end"] as const).map((kind) => {
                  const value = kind === "start" ? range.start : range.end;
                  // Tournée vers l'extérieur, sauf au bord de la loupe où elle serait coupée.
                  const inward =
                    kind === "start" ? x0 < HIT_PX : x1 > width - HIT_PX;
                  return (
                    <div
                      key={kind}
                      className={`xr-grip xr-grip--${kind}${inward ? " xr-grip--in" : ""}`}
                      style={{ left: kind === "start" ? 0 : "100%" }}
                      role="slider"
                      tabIndex={isSel ? 0 : -1}
                      aria-label={`${kind === "start" ? "Début" : "Fin"} de la plage ${index + 1}`}
                      aria-valuemin={0}
                      aria-valuemax={Math.round(duration * 10) / 10}
                      aria-valuenow={Math.round(value * 10) / 10}
                      aria-valuetext={spokenTime(value)}
                      data-testid={`grip-${kind}-${index + 1}`}
                      data-drag={
                        dragging === `${range.id}-${kind}` ? "" : undefined
                      }
                      onPointerDown={(e) => onRangeDown(e, range, kind)}
                      onKeyDown={(e) => onGripKey(e, range, kind)}
                    >
                      <span className="bubble">{formatClock(value)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {playing ? (
            <Playhead clock={clock} view={view} width={width} />
          ) : null}
        </div>
        <span className="xr-precision" aria-hidden="true">
          Précision ×5
        </span>
      </div>

      {pop && popVerse && popVerse.t ? (
        <div
          className="xr-pop"
          role="dialog"
          aria-label={`Passage ${popIndex}`}
          data-testid="timeline-pop"
          style={{
            left: Math.min(
              Math.max(pop.x, Math.min(popWidth, width) / 2),
              width - Math.min(popWidth, width) / 2,
            ),
          }}
          onKeyDown={(e) => e.key === "Escape" && setPop(null)}
        >
          <p>
            <b>{popVerse.ref ?? `Passage ${popIndex}`}</b>{" "}
            <span className="mono muted">
              {formatClock(popVerse.t[0])} → {formatClock(popVerse.t[1])}
            </span>
          </p>
          {popVerse.status === "uncertain" ? (
            <p className="muted">
              Passage ambigu : vérifie-le avant de l’exporter seul.
            </p>
          ) : (
            <button
              type="button"
              className="btn btn--primary"
              data-testid="pop-add"
              autoFocus
              onClick={() => {
                onAddVerse(pop.t);
                setPop(null);
              }}
            >
              <XIcon name="plus" />
              Ajouter ce verset
            </button>
          )}
          <button
            type="button"
            className="btn btn--ghost btn--icon"
            aria-label="Fermer"
            onClick={() => setPop(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      <div className="xr-ftools">
        <div className="grp">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="range-play"
            disabled={!selected}
            onClick={onTogglePlay}
          >
            <XIcon name={playing ? "pause" : "play"} />
            {playing ? "Arrêter" : "Écouter la plage"}
          </button>
          <span className="readout" data-testid="range-readout">
            {selected ? (
              <>
                Plage {selectedIndex + 1} ·{" "}
                <span className="mono">
                  {formatClock(selected.start)} → {formatClock(selected.end)}
                </span>{" "}
                · <b>{formatDurationFr(selected.end - selected.start)}</b>
              </>
            ) : (
              "Aucune plage choisie"
            )}
          </span>
        </div>
        <div className="grp">
          <button
            type="button"
            className="btn btn--secondary btn--icon"
            aria-label="Zoom arrière"
            data-testid="zoom-out"
            onClick={() => zoomBy(2)}
          >
            <XIcon name="zoom-out" />
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--icon"
            aria-label="Cadrer la plage choisie"
            data-testid="zoom-fit"
            onClick={() =>
              onView(
                selected
                  ? fitView(selected, duration, TL.minSpanSeconds)
                  : { a: 0, b: duration },
              )
            }
          >
            <XIcon name="fit" />
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--icon"
            aria-label="Zoom avant"
            data-testid="zoom-in"
            onClick={() => zoomBy(0.5)}
          >
            <XIcon name="zoom-in" />
          </button>
        </div>
      </div>
      <p className="xr-legend">
        <span>
          <i className="lg-rec" />
          Reconnu
        </span>
        <span>
          <i className="lg-inf" />
          Déduit
        </span>
        <span>
          <i className="lg-unc" />
          Ambigu
        </span>
        <span>
          <i className="lg-nq" />
          Non coranique
        </span>
        <span>
          <i className="lg-br" />
          Souffle gardé autour de la voix
        </span>
      </p>
    </div>
  );
}
