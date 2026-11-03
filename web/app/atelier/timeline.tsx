"use client";
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { formatTenths } from "@/lib/format";
import {
  indicesOverlapping,
  nearestIndex,
  timeIndexOf,
} from "@/lib/interval-index";
import {
  capBlocks,
  renderWindowFor,
  visibleTimeRange,
  windowFits,
  windowMatchesSpan,
  type Block,
  type Range,
  type SegLike,
} from "@/lib/timeline-window";
import {
  STEP_LARGE_S,
  STEP_S,
  traceToSelection,
  type Selection,
} from "@/lib/marking";
import {
  intervalLabel,
  intervalStateLabel,
  intervalStyle,
} from "@/lib/passage";
import type { Interval } from "@/lib/recognition";
import type { Annotation } from "@/lib/review";
import {
  centeredScroll,
  formatTick,
  laneWidthPercent,
  percentAt,
  tickStep,
  ticks,
  visibleSpan,
  isPanMove,
  panScrollLeft,
} from "@/lib/timeline";
import type { Store } from "@/lib/mini-store";
import { barHeights, peakNorm } from "@/lib/waveform";
import type { PlayerState } from "./use-player";

/** Largeur minimale (px) d'un segment pour y écrire sa référence sur la forme d'onde. */
const REGION_LABEL_PX = 34;
const BAR_WIDTH = 2.6;
const BAR_PITCH = 4.2;

export type TimelineHandle = { centerOn: (seconds: number) => void };

type Props = {
  duration: number;
  peaks: { duration: number; peaks: number[] } | null;
  intervals: readonly Interval[];
  selectedIndex: number | null;
  onSelectInterval: (index: number) => void;
  store: Store<PlayerState>;
  onSeek: (seconds: number) => void;
  span: number | null;
  follow: boolean;
  onUserMove: () => void;
  annotations: readonly Annotation[];
  selectedAnnotationId: string | null;
  draftId: string | null;
  mark: number | null;
  trace: boolean;
  /** Le tracé exige un testeur : appelé quand un geste de tracé démarre sans testeur. */
  onTrace: (selection: Selection) => void;
  onEdge: (id: string, edge: "start" | "end", seconds: number) => void;
  onNudge: (id: string, edge: "start" | "end", delta: number) => void;
  onSelectAnnotation: (id: string) => void;
};

type Live = { a: number; b: number } | null;

/** Couleur résolue d'une variable CSS (les `light-dark()` des tokens ne se lisent pas en brut). */
function resolveColor(node: HTMLElement, variable: string): string {
  const previous = node.style.color;
  node.style.color = `var(${variable})`;
  const color = getComputedStyle(node).color;
  node.style.color = previous;
  return color;
}

/** Un segment (ou un bloc de segments fondus) tel que la timeline le dessine. */
type SegView = {
  key: string;
  /** Intervalle du segment ; pour un bloc, le premier intervalle fondu. */
  index: number;
  run: boolean;
  className: string;
  left: string;
  width: string;
  pressed: boolean;
  label: string;
  /** Infobulle des pistes (l'onde n'en porte pas). */
  title: string | null;
  /** Référence écrite sur le segment quand il est assez large. */
  text: string | null;
};

/**
 * Segment de piste : raccourci au pointeur, hors de l'ordre de tabulation et masqué aux lecteurs
 * d'écran (la liste des intervalles fait exactement la même chose, au clavier). Mémorisé : un
 * changement de sélection ne redessine que les deux segments concernés.
 */
const SegmentButton = memo(function SegmentButton({
  seg,
  testId,
  onSelect,
  onPick,
}: {
  seg: SegView;
  testId: string;
  onSelect: (index: number) => void;
  onPick: (clientX: number) => void;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-index={seg.index}
      data-run={seg.run ? "" : undefined}
      tabIndex={-1}
      aria-hidden="true"
      className={seg.className}
      style={{ "--l": seg.left, "--w": seg.width } as React.CSSProperties}
      aria-pressed={seg.pressed}
      aria-label={seg.run ? undefined : seg.label}
      title={seg.run ? undefined : (seg.title ?? undefined)}
      onClick={
        seg.run ? (event) => onPick(event.clientX) : () => onSelect(seg.index)
      }
    >
      {seg.text ? <span>{seg.text}</span> : null}
    </button>
  );
});

/**
 * Forme d'onde, pistes synchronisées, légende : UN seul repère temporel. L'onde, les trois pistes,
 * la règle et la tête de lecture vivent dans le même conteneur défilant, donc la tête de lecture
 * traverse tout au même x, à n'importe quel zoom. L'onde est dessinée sur canvas à partir des crêtes
 * du serveur, uniquement pour la fenêtre visible.
 */
export const Timeline = forwardRef<TimelineHandle, Props>(
  function Timeline(props, ref) {
    const {
      duration,
      peaks,
      intervals,
      store,
      span,
      annotations,
      draftId,
      selectedAnnotationId,
      mark,
      trace,
    } = props;
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const baseRef = useRef<HTMLCanvasElement>(null);
    const playedRef = useRef<HTMLCanvasElement>(null);
    const playheadRef = useRef<HTMLDivElement>(null);
    const liveMarkRef = useRef<HTMLDivElement>(null);
    const [viewportW, setViewportW] = useState(0);
    const [live, setLive] = useState<Live>(null);
    // Fenêtre de rendu (en secondes) : seuls les segments qui la touchent existent dans le DOM.
    const [win, setWin] = useState<Range | null>(null);
    const colors = useRef<{ wave: string; played: string } | null>(null);
    const latest = useRef(props);
    latest.current = props;
    const gesture = useRef<
      | { kind: "trace"; x0: number; t0: number; moved: boolean }
      | { kind: "edge"; id: string; edge: "start" | "end" }
      | null
    >(null);
    /* glisser pour naviguer : appui sur la timeline (hors tracé), puis déplacement horizontal */
    const pan = useRef<{
      x0: number;
      left0: number;
      id: number;
      moved: boolean;
    } | null>(null);
    const suppressClick = useRef(false);
    const frame = useRef(0);
    const norm = useMemo(() => (peaks ? peakNorm(peaks.peaks) : 1), [peaks]);

    const contentPct = laneWidthPercent(duration, span);
    const contentPx = (viewportW * contentPct) / 100;

    /* ── dessin de l'onde (fenêtre visible seulement) ── */
    const draw = useCallback(() => {
      const scroll = scrollRef.current;
      const base = baseRef.current;
      const played = playedRef.current;
      if (!scroll || !base || !played) return;
      const w = scroll.clientWidth;
      const h = base.clientHeight;
      if (!w || !h) return;
      const dpr = window.devicePixelRatio || 1;
      for (const canvas of [base, played]) {
        if (canvas.width !== Math.round(w * dpr))
          canvas.width = Math.round(w * dpr);
        if (canvas.height !== Math.round(h * dpr))
          canvas.height = Math.round(h * dpr);
      }
      const total = contentRef.current?.clientWidth || w;
      const t0 = duration > 0 ? (scroll.scrollLeft / total) * duration : 0;
      const t1 =
        duration > 0 ? ((scroll.scrollLeft + w) / total) * duration : 0;
      const bars = Math.max(1, Math.floor(w / BAR_PITCH));
      const heights = peaks
        ? barHeights(peaks.peaks, peaks.duration, t0, t1, bars, norm)
        : [];
      // Résolues une fois par thème : chaque lecture de style forcée coûte un recalcul de la page.
      const palette = (colors.current ??= {
        wave: resolveColor(base, "--wave"),
        played: resolveColor(played, "--wave-played"),
      });
      const paint = (canvas: HTMLCanvasElement, color: string) => {
        const context = canvas.getContext("2d");
        if (!context) return;
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, w, h);
        context.fillStyle = color;
        const middle = h / 2;
        const pitch = w / bars;
        heights.forEach((value, i) => {
          const bar = Math.max(2, value * (h - 12));
          const x = i * pitch + (pitch - BAR_WIDTH) / 2;
          context.beginPath();
          context.roundRect(x, middle - bar / 2, BAR_WIDTH, bar, 1.3);
          context.fill();
        });
      };
      paint(base, palette.wave);
      paint(played, palette.played);
    }, [duration, peaks, norm]);

    /* ── tête de lecture, partie écoutée, pose en cours, suivi de la lecture ── */
    const sync = useCallback(() => {
      const scroll = scrollRef.current;
      const content = contentRef.current;
      if (!scroll || !content || !(duration > 0)) return;
      const { time } = store.get();
      const total = content.clientWidth;
      const w = scroll.clientWidth;
      const x = (time / duration) * total;
      // `transform` (compositeur) et non `left` : pas de mise en page à chaque image de lecture.
      if (playheadRef.current)
        playheadRef.current.style.transform = `translate3d(${(percentAt(time, duration) / 100) * total}px,0,0)`;
      if (playedRef.current) {
        const visible = Math.max(0, Math.min(w, x - scroll.scrollLeft));
        playedRef.current.style.clipPath = `inset(0 ${w - visible}px 0 0)`;
      }
      const markAt = latest.current.mark;
      if (liveMarkRef.current && markAt !== null) {
        const end = Math.max(time, markAt);
        liveMarkRef.current.style.setProperty(
          "--l",
          `${percentAt(markAt, duration)}%`,
        );
        liveMarkRef.current.style.setProperty(
          "--w",
          `${percentAt(end - markAt, duration)}%`,
        );
      }
    }, [duration, store]);

    const scheduleDraw = useCallback(() => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        draw();
        sync();
      });
    }, [draw, sync]);

    const followNow = useCallback(() => {
      const scroll = scrollRef.current;
      const content = contentRef.current;
      if (
        !scroll ||
        !content ||
        !latest.current.follow ||
        latest.current.span === null
      )
        return;
      const target = centeredScroll(
        store.get().time,
        duration,
        scroll.clientWidth,
        content.clientWidth,
      );
      if (Math.abs(scroll.scrollLeft - target) > 0.5)
        scroll.scrollLeft = target;
    }, [duration, store]);

    useEffect(() => {
      const onChange = () => {
        followNow();
        sync();
      };
      onChange();
      return store.subscribe(onChange);
    }, [store, followNow, sync]);

    useImperativeHandle(
      ref,
      () => ({
        centerOn(seconds: number) {
          const scroll = scrollRef.current;
          const content = contentRef.current;
          if (!scroll || !content) return;
          scroll.scrollLeft = centeredScroll(
            seconds,
            duration,
            scroll.clientWidth,
            content.clientWidth,
          );
          scheduleDraw();
        },
      }),
      [duration, scheduleDraw],
    );

    /* ── fenêtre de rendu : ce que la vue touche, plus une marge ── */
    const refreshWindow = useCallback(() => {
      const scroll = scrollRef.current;
      const content = contentRef.current;
      if (!scroll || !content || !(duration > 0)) return;
      const visible = visibleTimeRange(
        scroll.scrollLeft,
        scroll.clientWidth,
        content.clientWidth,
        duration,
      );
      // Même objet tant que la vue reste dedans : aucun rendu pendant le défilement ordinaire.
      setWin((previous) =>
        windowFits(previous, visible)
          ? previous
          : renderWindowFor(visible, duration),
      );
    }, [duration]);

    /* ── redessin : taille, défilement, zoom, thème ── */
    useEffect(() => {
      const scroll = scrollRef.current;
      if (!scroll) return;
      const observer = new ResizeObserver(() => {
        setViewportW(scroll.clientWidth);
        refreshWindow();
        scheduleDraw();
      });
      observer.observe(scroll);
      const onScroll = () => {
        refreshWindow();
        scheduleDraw();
      };
      scroll.addEventListener("scroll", onScroll, { passive: true });
      const onTheme = () => {
        colors.current = null;
        scheduleDraw();
      };
      const themeObserver = new MutationObserver(onTheme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", onTheme);
      return () => {
        observer.disconnect();
        scroll.removeEventListener("scroll", onScroll);
        themeObserver.disconnect();
        media.removeEventListener("change", onTheme);
        cancelAnimationFrame(frame.current);
      };
    }, [scheduleDraw, refreshWindow]);

    // Avant la peinture : un changement d'échelle ou de largeur recalcule la fenêtre sans image vide.
    useLayoutEffect(() => {
      refreshWindow();
    }, [refreshWindow, contentPct, viewportW]);

    useEffect(() => {
      scheduleDraw();
    }, [scheduleDraw, span, peaks, duration, contentPct]);

    // Changement d'échelle : la position courante revient au centre de la vue.
    useEffect(() => {
      const scroll = scrollRef.current;
      const content = contentRef.current;
      if (!scroll || !content || !(duration > 0)) return;
      scroll.scrollLeft = centeredScroll(
        store.get().time,
        duration,
        scroll.clientWidth,
        content.clientWidth,
      );
      scheduleDraw();
    }, [span, duration, store, scheduleDraw]);

    /* ── gestes sur l'onde : déplacer la lecture, tracer, tirer une poignée ── */
    const timeAt = useCallback(
      (clientX: number): number => {
        const row = rowRef.current;
        if (!row || !(duration > 0)) return 0;
        const rect = row.getBoundingClientRect();
        return Math.max(
          0,
          Math.min(duration, ((clientX - rect.left) / rect.width) * duration),
        );
      },
      [duration],
    );

    const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement;
      const handle = target.closest<HTMLElement>(".rv-h");
      const row = rowRef.current;
      if (!row) return;
      if (handle && handle.dataset.id) {
        event.preventDefault();
        row.setPointerCapture(event.pointerId);
        gesture.current = {
          kind: "edge",
          id: handle.dataset.id,
          edge: handle.dataset.edge === "end" ? "end" : "start",
        };
        return;
      }
      if (!(latest.current.trace || event.shiftKey)) return;
      if (event.button !== 0) return;
      event.preventDefault();
      row.setPointerCapture(event.pointerId);
      gesture.current = {
        kind: "trace",
        x0: event.clientX,
        t0: timeAt(event.clientX),
        moved: false,
      };
    };

    const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      if (!g) return;
      const t = timeAt(event.clientX);
      if (g.kind === "edge") {
        latest.current.onEdge(g.id, g.edge, t);
        return;
      }
      if (Math.abs(event.clientX - g.x0) > 6) g.moved = true;
      if (g.moved) setLive({ a: Math.min(g.t0, t), b: Math.max(g.t0, t) });
    };

    const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
      const g = gesture.current;
      gesture.current = null;
      if (!g || g.kind === "edge") return;
      setLive(null);
      const t1 = timeAt(event.clientX);
      const selection = traceToSelection({
        t0: g.t0,
        t1,
        dxPx: event.clientX - g.x0,
      });
      latest.current.onSeek(selection.start);
      latest.current.onTrace(selection);
    };

    const onScrollPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      props.onUserMove();
      // Souris ou stylet seulement : au doigt, le défilement natif fait déjà le travail.
      if (event.pointerType === "touch" || event.button !== 0) return;
      if (gesture.current !== null || event.shiftKey) return; // tracé ou poignée en cours
      const target = event.target as HTMLElement;
      if (target.closest(".rv-h")) return;
      if (latest.current.trace && target.closest(".tl-wave")) return; // l'onde trace
      const scroll = scrollRef.current;
      if (!scroll) return;
      pan.current = {
        x0: event.clientX,
        left0: scroll.scrollLeft,
        id: event.pointerId,
        moved: false,
      };
    };

    const onScrollPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      const g = pan.current;
      const scroll = scrollRef.current;
      if (!g || !scroll || event.pointerId !== g.id) return;
      const dx = event.clientX - g.x0;
      if (!g.moved) {
        if (!isPanMove(dx)) return;
        g.moved = true;
        // Capture seulement une fois le glissement commencé : un simple clic garde sa cible.
        scroll.setPointerCapture(event.pointerId);
        scroll.classList.add("panning");
      }
      scroll.scrollLeft = panScrollLeft(
        g.left0,
        dx,
        scroll.scrollWidth - scroll.clientWidth,
      );
    };

    const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
      const g = pan.current;
      pan.current = null;
      const scroll = scrollRef.current;
      scroll?.classList.remove("panning");
      if (!g?.moved) return;
      if (scroll?.hasPointerCapture(event.pointerId))
        scroll.releasePointerCapture(event.pointerId);
      // Le clic qui suit un glissement ne doit pas déplacer la lecture ni choisir un segment.
      suppressClick.current = true;
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 0);
    };

    const onRowClick = (event: React.MouseEvent<HTMLDivElement>) => {
      if (latest.current.trace || event.shiftKey) return;
      if ((event.target as HTMLElement).closest("button,.rv-h")) return;
      latest.current.onSeek(timeAt(event.clientX));
    };

    const onHandleKey = (event: React.KeyboardEvent<HTMLElement>) => {
      const handle = (event.target as HTMLElement).closest<HTMLElement>(
        ".rv-h",
      );
      if (!handle?.dataset.id) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const step =
        (event.key === "ArrowRight" ? 1 : -1) *
        (event.shiftKey ? STEP_LARGE_S : STEP_S);
      latest.current.onNudge(
        handle.dataset.id,
        handle.dataset.edge === "end" ? "end" : "start",
        step,
      );
    };

    /* ── éléments ── */
    const pxPerSecond = duration > 0 ? contentPx / duration : 0;
    const shownSpan = visibleSpan(duration, span);
    const step = tickStep(shownSpan, viewportW || Infinity);
    // Fenêtre de rendu valable pour l'échelle actuelle : au changement de zoom, l'ancienne fenêtre
    // (recalculée avant la peinture) ne dessine rien plutôt que des milliers de segments à la mauvaise échelle.
    const renderWin = windowMatchesSpan(win, shownSpan) ? win : null;
    // Graduations de la fenêtre de rendu seulement (8 000 au pas d'une seconde pour 2 h sinon).
    const tickMarks = useMemo(
      () =>
        renderWin
          ? ticks(duration, step, renderWin.a, renderWin.b).map((t) => (
              <span key={t} style={{ left: `${percentAt(t, duration)}%` }}>
                {formatTick(t, step)}
              </span>
            ))
          : null,
      [duration, step, renderWin],
    );

    // Les segments des pistes sont des raccourcis au pointeur : à l'échelle d'un fichier entier ils
    // font quelques pixels. Hors de l'ordre de tabulation et masqués aux lecteurs d'écran, car la liste
    // des intervalles (lignes de 44 px, au clavier) fait exactement la même chose (WCAG 2.5.8 : contrôle
    // équivalent sur la même page). Seuls ceux qui touchent la fenêtre de rendu existent dans le DOM, et
    // les segments trop étroits pour être distingués se fondent en blocs (cliquables au temps du clic).
    const timeIndex = useMemo(() => timeIndexOf(intervals), [intervals]);
    const candidates = useMemo(() => {
      if (!renderWin) return null;
      const all: SegLike[] = indicesOverlapping(
        timeIndex,
        renderWin.a,
        renderWin.b,
      )
        .map((index) => {
          const item = intervals[index];
          const [start, end] = item.t as [number, number];
          return { index, start, end, style: intervalStyle(item) };
        })
        .sort((x, y) => x.start - y.start);
      const inferred = (s: SegLike) => {
        const item = intervals[s.index];
        return item.kind === "verse" && item.status === "inferred";
      };
      return {
        wave: all,
        main: all.filter((s) => !inferred(s)),
        inferred: all.filter(inferred),
      };
    }, [renderWin, timeIndex, intervals]);

    const selectedInterval = props.selectedIndex;
    const layers = useMemo(() => {
      const none: SegView[] = [];
      if (!candidates || !(pxPerSecond > 0))
        return { wave: none, main: none, inferred: none };
      const pct = (seconds: number) => `${percentAt(seconds, duration)}%`;
      const view = (blocks: Block[], lane: boolean): SegView[] =>
        blocks.map((block) => {
          if (block.kind === "run")
            return {
              key: `${lane ? "l" : "w"}r${block.first}`,
              index: block.first,
              run: true,
              className: `${lane ? "seg" : "wave-seg"} s-${block.style}`,
              left: pct(block.start),
              width: pct(block.end - block.start),
              pressed: false,
              label: "",
              title: null,
              text: null,
            };
          const item = intervals[block.index];
          const [start, end] = item.t as [number, number];
          const label = `${intervalLabel(item)} · ${intervalStateLabel(item)}`;
          return {
            key: `${lane ? "l" : "w"}${block.index}`,
            index: block.index,
            run: false,
            className: `${lane ? "seg" : "wave-seg"} s-${intervalStyle(item)}`,
            left: pct(start),
            width: pct(end - start),
            pressed: selectedInterval === block.index,
            label,
            title: lane
              ? `${intervalLabel(item)} · ${formatTenths(start)} – ${formatTenths(end)}`
              : null,
            text:
              !lane &&
              (end - start) * pxPerSecond >= REGION_LABEL_PX &&
              item.kind === "verse" &&
              item.status !== "uncertain" &&
              item.ref
                ? item.ref
                : null,
          };
        });
      const blocks = (segs: SegLike[]) =>
        capBlocks(segs, pxPerSecond, undefined, selectedInterval);
      return {
        wave: view(blocks(candidates.wave), false),
        main: view(blocks(candidates.main), true),
        inferred: view(blocks(candidates.inferred), true),
      };
    }, [candidates, pxPerSecond, duration, intervals, selectedInterval]);

    const onSelectSegment = useCallback(
      (index: number) => latest.current.onSelectInterval(index),
      [],
    );
    const onPickSegment = useCallback(
      (clientX: number) => {
        const index = nearestIndex(timeIndex, timeAt(clientX));
        if (index >= 0) latest.current.onSelectInterval(index);
      },
      [timeIndex, timeAt],
    );
    const segments = (views: SegView[], testId: string) =>
      views.map((seg) => (
        <SegmentButton
          key={seg.key}
          seg={seg}
          testId={testId}
          onSelect={onSelectSegment}
          onPick={onPickSegment}
        />
      ));

    const pct = (seconds: number) => `${percentAt(seconds, duration)}%`;
    const regions = annotations.map((a) => {
      const isPoint = a.end_s === null;
      const selected = selectedAnnotationId === a.id;
      const editing = draftId === a.id;
      const style = {
        "--l": pct(a.start_s),
        ...(isPoint ? {} : { "--w": pct((a.end_s as number) - a.start_s) }),
      } as React.CSSProperties;
      return (
        <div
          key={a.id}
          data-testid="review-region"
          data-id={a.id}
          className={`rv-region ${a.status}${isPoint ? " pt" : ""}${selected ? " sel" : ""}`}
          style={style}
        >
          <button
            type="button"
            className="rv-hit"
            tabIndex={-1}
            aria-hidden="true"
            aria-label={`Signalement de ${a.tester} à ${formatTenths(a.start_s)}`}
            onClick={() => props.onSelectAnnotation(a.id)}
          />
          {selected && !editing ? (
            <span className="rv-label">{a.tester}</span>
          ) : null}
          {editing ? (
            <>
              <span
                className="rv-h"
                data-edge="start"
                data-id={a.id}
                role="slider"
                tabIndex={0}
                aria-label="Début de la plage"
                aria-valuemin={0}
                aria-valuemax={duration}
                aria-valuenow={a.start_s}
                aria-valuetext={`Début ${formatTenths(a.start_s)}`}
              >
                <i />
              </span>
              {isPoint ? null : (
                <span
                  className="rv-h"
                  data-edge="end"
                  data-id={a.id}
                  role="slider"
                  tabIndex={0}
                  aria-label="Fin de la plage"
                  aria-valuemin={0}
                  aria-valuemax={duration}
                  aria-valuenow={a.end_s as number}
                  aria-valuetext={`Fin ${formatTenths(a.end_s as number)}`}
                >
                  <i />
                </span>
              )}
            </>
          ) : null}
        </div>
      );
    });

    const humans = annotations.map((a) => (
      <button
        key={a.id}
        type="button"
        data-testid="review-lane-item"
        tabIndex={-1}
        aria-hidden="true"
        className={`human${a.status === "draft" ? " draft" : ""}${a.end_s === null ? " pt" : ""}${selectedAnnotationId === a.id ? " sel" : ""}`}
        style={
          {
            "--l": pct(a.start_s),
            ...(a.end_s === null ? {} : { "--w": pct(a.end_s - a.start_s) }),
          } as React.CSSProperties
        }
        title={`${a.tester} · ${formatTenths(a.start_s)} · ${a.status === "draft" ? "brouillon" : "confirmé"}`}
        aria-label={`Signalement de ${a.tester} à ${formatTenths(a.start_s)}`}
        onClick={() => props.onSelectAnnotation(a.id)}
      />
    ));

    return (
      <div className="timeline" data-testid="timeline">
        <div className="tl-grid">
          <div className="tl-names" aria-hidden="true">
            <div className="tl-name" data-short="Onde">
              <b>Onde</b>
              <small>copie du moteur</small>
            </div>
            <div className="tl-name" data-short="Moteur">
              <b>Moteur</b>
            </div>
            <div className="tl-name" data-short="Hypoth.">
              <b>Hypothèses</b>
            </div>
            <div className="tl-name" data-short="Revue">
              <b>Revue</b>
            </div>
            <div />
          </div>
          <div
            ref={scrollRef}
            className={`tl-scroll${contentPct > 100 ? " can-pan" : ""}`}
            data-testid="timeline-scroll"
            onWheel={props.onUserMove}
            onPointerDown={onScrollPointerDown}
            onPointerMove={onScrollPointerMove}
            onPointerUp={endPan}
            onPointerCancel={endPan}
            onClickCapture={(event) => {
              if (!suppressClick.current) return;
              event.stopPropagation();
              event.preventDefault();
              suppressClick.current = false;
            }}
          >
            <div
              ref={contentRef}
              className="tl-content"
              style={{ width: `${contentPct}%` }}
            >
              <div
                ref={rowRef}
                className={`tl-row tl-wave${trace ? " tracing" : ""}`}
                data-testid="wave-track"
                role="group"
                aria-label="Forme d’onde ; cliquer pour se déplacer dans l’audio"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                  gesture.current = null;
                  setLive(null);
                }}
                onClick={onRowClick}
                onKeyDown={onHandleKey}
              >
                <div className="wave-stick">
                  <canvas
                    ref={baseRef}
                    className="wave-canvas"
                    aria-hidden="true"
                  />
                  <canvas
                    ref={playedRef}
                    className="wave-canvas"
                    aria-hidden="true"
                  />
                </div>
                <div className="wave-layer">
                  {segments(layers.wave, "wave-seg")}
                </div>
                <div className="rv-layer">
                  {regions}
                  {mark !== null ? (
                    <div
                      ref={liveMarkRef}
                      className="rv-region live"
                      data-testid="live-mark"
                    >
                      <span className="rv-label">
                        Début {formatTenths(mark)}
                      </span>
                    </div>
                  ) : null}
                  {live ? (
                    <div
                      className="rv-region live"
                      data-testid="live-trace"
                      style={
                        {
                          "--l": pct(live.a),
                          "--w": pct(live.b - live.a),
                        } as React.CSSProperties
                      }
                    >
                      <span className="rv-label">
                        {formatTenths(live.a)} → {formatTenths(live.b)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="tl-row tl-lane" data-testid="lane-main">
                {segments(layers.main, "lane-seg")}
              </div>
              <div className="tl-row tl-lane" data-testid="lane-inferred">
                {segments(layers.inferred, "lane-seg")}
              </div>
              <div className="tl-row tl-lane" data-testid="lane-review">
                {humans}
              </div>
              <div className="tl-ticks" aria-hidden="true">
                {tickMarks}
              </div>
              <div
                ref={playheadRef}
                className="playhead"
                data-testid="playhead"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
        {trace ? (
          <p className="trace-hint" role="status">
            Glisse pour une plage · touche pour un point · l’outil se ferme
            après le tracé (Échap pour sortir avant)
          </p>
        ) : null}
      </div>
    );
  },
);
