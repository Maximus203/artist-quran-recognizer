"use client";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import {
  filmSegments,
  playheadKey,
  pxToTime,
  rulerMarks,
  scrollAfterZoom,
  scrollToReveal,
  stepZoom,
  timeToPx,
  trackWidth,
  zoomLevels,
  type PassageBlock,
  type StillStyle,
} from "@/lib/export-table-timeline";
import { MODE_CHOICES } from "@/lib/background-video-view";
import { formatClock, spokenTime } from "@/lib/export-timeline";
import type { BackgroundVideoMode } from "@/lib/export-video-model";
import type { WavePeaks } from "@/lib/export-wave";
import type { Store } from "@/lib/mini-store";
import { useStoreValue } from "../../hooks";
import type { BackgroundVideoValue } from "../background-video-view";
import { Glyph } from "../background-video-view";
import { WaveCanvas } from "../wave-canvas";
import { overflowFade, useHoldRepeat } from "./controls";
import { clipPillText, ClipTrack, FilmFoot } from "./table-film";
import { TIcon } from "./table-icons";

/**
 * LA CHRONOLOGIE de la table de montage : la récitation de gauche à droite, du début à la fin. Une règle de
 * temps, puis des PISTES — les passages (versets), l'onde du son, le fond — et la TÊTE DE LECTURE, la ligne
 * verticale qui désigne l'instant montré dans l'aperçu. Elle se déplace en la glissant sur la règle ou sur
 * l'onde, avec les boutons ◀ ▶ (0,1 s et 1 s, appui long qui répète), avec les flèches du clavier, ou en
 * sautant d'un passage à l'autre.
 *
 * Zoomée, la piste devient plus large que l'écran et DÉFILE TOUTE SEULE (glisser les passages ou le fond, ou
 * le clavier) : la page, elle, ne défile jamais de côté. La tête de lecture vit dans un magasin observable
 * (`head`) lu hors de React : sa ligne, sa bulle et la couleur de l'onde suivent le doigt ou la lecture sans
 * redessiner la chronologie à chaque image.
 *
 * Toute la géométrie est dans `lib/export-table-timeline.ts` (testée) ; ce fichier lit les gestes et dessine.
 */

export const RULER_H = 30;
export const PASS_H = 34;
export const WAVE_H = 48;
export const FILM_H = 56;
/** Écart visé entre deux repères principaux de la règle (px). */
const RULER_TARGET_PX = 64;
/**
 * Marge de chaque côté des pistes (px) : la poignée de la tête de lecture mesure 44 px et déborde de la moitié
 * aux deux extrémités. Égale à `--hit / 2` (voir `export-table.css`).
 */
const SCROLL_PAD = 22;
/** Place qu'une étiquette de la règle demande à droite de son repère : au-delà, elle passe à gauche. */
const TICK_LABEL_PX = 40;
/** Marge gardée entre la tête de lecture et le bord de l'écran quand la piste défile (px). */
const FOLLOW_MARGIN = 28;
/** Le texte annoncé après une série de pas : attendre que l'appui long s'arrête. */
const ANNOUNCE_DELAY_MS = 450;

const MODE_NAME = Object.fromEntries(
  MODE_CHOICES.map((choice) => [choice.mode, choice.title.toLowerCase()]),
) as Record<BackgroundVideoMode, string>;

export type FilmTrackData =
  | {
      kind: "still";
      label: string;
      source: boolean;
      /** Ce que la piste dessine pour cette image, ce dégradé ou cette couleur ; absent : une teinte neutre. */
      style?: StillStyle | null;
    }
  | {
      kind: "clip";
      clip: BackgroundVideoValue;
      frames: ReadonlyArray<string | null>;
    };

export type TimelineProps = {
  duration: number;
  peaks: WavePeaks | null;
  blocks: readonly PassageBlock[];
  /** Les plages exportées (une vidéo chacune). */
  ranges: ReadonlyArray<{ id: number; start: number; end: number }>;
  /** La plus longue (s) : borne le départ de la vidéo de fond. */
  longest: number;
  film: FilmTrackData;
  /** Position de la tête de lecture (s) : change à chaque image pendant un glisser ou une lecture. */
  head: Store<number>;
  /** Niveau de zoom (1 = tout voir), gardé par l'éditeur : il survit au masquage de la chronologie. */
  zoom: number;
  onZoom: (zoom: number) => void;
  /** Vue réduite (un panneau de cadre est ouvert) : ni règle, ni passages, ni boutons. */
  compact: boolean;
  onSeek: (t: number) => void;
  onNudge: (delta: number) => void;
  onJump: (direction: -1 | 1) => void;
  /** Nombre de plages exportées : un seul départ de la vidéo de fond vaut pour toutes. */
  parts: number;
  onClip: (clip: BackgroundVideoValue) => void;
  onHelp: () => void;
  announce: (message: string) => void;
};

/** La largeur utile d'un élément, déduction faite de `inset` px de chaque côté (la marge où déborde la poignée). */
function useElementWidth(
  ref: RefObject<HTMLElement | null>,
  inset: number,
): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const read = () => setWidth(Math.max(0, node.clientWidth - 2 * inset));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, inset]);
  return width;
}

/** Annonce regroupée : une série de pas ne dit que le dernier. */
function useSoon(announce: (message: string) => void) {
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  return useCallback(
    (message: string) => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(
        () => announce(message),
        ANNOUNCE_DELAY_MS,
      );
    },
    [announce],
  );
}

/** Les passages : un bloc par verset, éteint s'il n'est dans aucune plage exportée. */
function PassageRow({
  blocks,
  head,
  duration,
  width,
}: {
  blocks: readonly PassageBlock[];
  head: Store<number>;
  duration: number;
  width: number;
}) {
  const current = useStoreValue(
    head,
    (t) => blocks.find((b) => t >= b.start && t < b.end)?.index ?? -1,
  );
  return (
    <div
      className="xt-track xt-pass"
      role="group"
      aria-label="Passages"
      data-testid="tl-passages"
      style={{ height: PASS_H }}
    >
      <span className="xt-lab">Passages</span>
      {blocks.map((block) => {
        const left = timeToPx(block.start, duration, width);
        const w = Math.max(3, timeToPx(block.end, duration, width) - left - 2);
        return (
          <div
            key={block.index}
            className="xt-blk"
            role="img"
            aria-label={`Passage ${block.label}, de ${spokenTime(block.start)} à ${spokenTime(block.end)}${block.included ? "" : ", hors de la vidéo"}`}
            aria-current={current === block.index ? "true" : undefined}
            data-status={block.status}
            data-included={block.included || undefined}
            style={{ left, width: w }}
          >
            {w > 18 ? <span>{block.label}</span> : null}
          </div>
        );
      })}
    </div>
  );
}

/** La bulle de la tête de lecture : l'instant, au dixième. */
function Bubble({ head }: { head: Store<number> }) {
  const text = useStoreValue(head, (t) => formatClock(t));
  return (
    <span className="xt-bubble" aria-hidden="true" data-testid="tl-time">
      {text}
    </span>
  );
}

/** La poignée de la tête de lecture : un curseur clavier et lecteur d'écran (la règle et l'onde se glissent aussi). */
function HeadKnob({
  head,
  duration,
  onKey,
  down,
  move,
  up,
}: {
  head: Store<number>;
  duration: number;
  onKey: (event: KeyboardEvent<HTMLDivElement>) => void;
  down: (event: PointerEvent<HTMLElement>) => void;
  move: (event: PointerEvent<HTMLElement>) => void;
  up: (event: PointerEvent<HTMLElement>) => void;
}) {
  const now = useStoreValue(head, (t) => Math.round(t * 10) / 10);
  return (
    <div
      className="xt-knob"
      role="slider"
      tabIndex={0}
      aria-label="Tête de lecture : l’instant montré dans l’aperçu"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 10) / 10}
      aria-valuenow={now}
      aria-valuetext={`${spokenTime(now)} sur ${spokenTime(duration)}`}
      data-testid="tl-head"
      onKeyDown={onKey}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <i aria-hidden="true" />
    </div>
  );
}

export function TableTimeline(props: TimelineProps) {
  const {
    duration,
    peaks,
    blocks,
    ranges,
    longest,
    film,
    head,
    zoom,
    compact,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const tracksRef = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const pendingScroll = useRef<number | null>(null);
  const [modesOpen, setModesOpen] = useState(false);
  const soon = useSoon(props.announce);

  const viewport = useElementWidth(scrollRef, SCROLL_PAD);
  const levels = useMemo(
    () => zoomLevels(viewport, duration),
    [viewport, duration],
  );
  const level = levels.includes(zoom) ? zoom : stepZoom(zoom, 1, levels);
  const width = trackWidth(viewport, level);
  const pxPerSecond = duration > 0 ? width / duration : 0;
  const marks = useMemo(
    () => rulerMarks(duration, width, RULER_TARGET_PX),
    [duration, width],
  );
  const included = useCallback(
    (t: number) => ranges.some((r) => t >= r.start && t <= r.end),
    [ranges],
  );
  const segments = useMemo(
    () =>
      film.kind === "clip"
        ? filmSegments(ranges, {
            duration: film.clip.duration,
            offset: film.clip.offset,
            mode: film.clip.mode,
          })
        : [],
    [film, ranges],
  );

  // La ligne de la tête de lecture, la bulle et le défilement qui la suit : hors de React, à chaque changement.
  useEffect(() => {
    const tracks = tracksRef.current;
    const scroller = scrollRef.current;
    if (!tracks || !scroller || !(width > 0)) return;
    // Abscisse de la tête dans la zone qui défile (la marge de gauche comprise).
    const inScroller = () => SCROLL_PAD + timeToPx(head.get(), duration, width);
    const side = () => {
      const x = inScroller() - scroller.scrollLeft;
      tracks.dataset.side =
        x < 64 ? "right" : x > scroller.clientWidth - 64 ? "left" : "center";
    };
    const place = () => {
      tracks.style.setProperty(
        "--head",
        `${timeToPx(head.get(), duration, width)}px`,
      );
      if (!scrubbing.current) {
        const next = scrollToReveal(
          scroller.scrollLeft,
          scroller.clientWidth,
          inScroller(),
          FOLLOW_MARGIN,
        );
        if (Math.abs(next - scroller.scrollLeft) > 0.5)
          scroller.scrollLeft = next;
      }
      side();
    };
    place();
    scroller.addEventListener("scroll", side, { passive: true });
    const stop = head.subscribe(place);
    return () => {
      scroller.removeEventListener("scroll", side);
      stop();
    };
  }, [head, duration, width]);

  // Après un zoom : l'instant ancré reste au même endroit de l'écran.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (pendingScroll.current !== null && scroller) {
      scroller.scrollLeft = pendingScroll.current;
      pendingScroll.current = null;
    }
  }, [width]);

  const changeZoom = (next: number) => {
    const scroller = scrollRef.current;
    if (!scroller || next === level) return;
    pendingScroll.current = scrollAfterZoom({
      scrollLeft: scroller.scrollLeft,
      viewport,
      oldWidth: width,
      newWidth: trackWidth(viewport, next),
      anchor: head.get(),
      duration,
    });
    props.onZoom(next);
    soon(next === 1 ? "Tout voir." : `Zoom ×${next}.`);
  };

  // Glisser la tête de lecture sur la règle ou sur l'onde.
  const activePointer = useRef<number | null>(null);
  const at = (event: PointerEvent<HTMLElement>) => {
    const rect = tracksRef.current?.getBoundingClientRect();
    return rect ? pxToTime(event.clientX - rect.left, duration, rect.width) : 0;
  };
  const down = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = event.pointerId;
    scrubbing.current = true;
    props.onSeek(at(event));
  };
  const move = (event: PointerEvent<HTMLElement>) => {
    if (activePointer.current === event.pointerId) props.onSeek(at(event));
  };
  const up = (event: PointerEvent<HTMLElement>) => {
    if (activePointer.current !== event.pointerId) return;
    activePointer.current = null;
    scrubbing.current = false;
    soon(`Tête de lecture : ${spokenTime(head.get())}.`);
  };
  const scrub = {
    onPointerDown: down,
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: up,
  };

  const keyOnHead = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      return changeZoom(stepZoom(level, 1, levels));
    }
    if (event.key === "-") {
      event.preventDefault();
      return changeZoom(stepZoom(level, -1, levels));
    }
    const action = playheadKey(event.key, event.shiftKey);
    if (!action) return;
    event.preventDefault();
    const before = head.get();
    if ("delta" in action) props.onNudge(action.delta);
    else if ("to" in action) props.onSeek(action.to === "start" ? 0 : duration);
    else props.onJump(action.jump);
    if (head.get() !== before)
      soon(`Tête de lecture : ${spokenTime(head.get())}.`);
  };

  // Les pas de la tête : un appui fait le pas, tenu il se répète jusqu'à la borne.
  const step = (delta: number) => {
    const before = head.get();
    props.onNudge(delta);
    soon(`Tête de lecture : ${spokenTime(head.get())}.`);
    return head.get() !== before;
  };
  const back1 = useHoldRepeat(() => step(-1));
  const back01 = useHoldRepeat(() => step(-0.1));
  const fwd01 = useHoldRepeat(() => step(0.1));
  const fwd1 = useHoldRepeat(() => step(1));
  const jump = (direction: -1 | 1) => {
    const before = head.get();
    props.onJump(direction);
    // Pas de passage dans ce sens : l'éditeur l'annonce lui-même, on ne le recouvre pas.
    if (head.get() !== before)
      soon(
        `Passage ${direction < 0 ? "précédent" : "suivant"} : ${spokenTime(head.get())}.`,
      );
  };

  const onOffset = (offset: number, announce: boolean) => {
    if (film.kind !== "clip") return;
    props.onClip({ ...film.clip, offset });
    if (announce)
      soon(`Début de la partie de la vidéo de fond : ${spokenTime(offset)}.`);
  };

  const canZoom = levels.length > 1;
  return (
    <section
      className="xt-tl"
      aria-label="Chronologie"
      data-testid="table-timeline"
      data-compact={compact || undefined}
      data-zoom={level}
    >
      {compact ? null : (
        <header className="xt-tl-head">
          <h2>Chronologie</h2>
          <button
            type="button"
            className="xt-icon"
            aria-label="Comment lire la chronologie"
            data-testid="tl-help"
            onClick={props.onHelp}
          >
            <TIcon name="help" size={22} />
          </button>
          {canZoom ? (
            <div
              className="xt-zoom"
              role="group"
              aria-label="Zoom de la chronologie"
            >
              <button
                type="button"
                className="xt-icon"
                aria-label="Voir plus large"
                disabled={level === levels[0]}
                data-testid="tl-zoom-out"
                onClick={() => changeZoom(stepZoom(level, -1, levels))}
              >
                <TIcon name="zoom-out" size={22} />
              </button>
              <button
                type="button"
                className="xt-zoom-val"
                aria-label={
                  level === 1
                    ? "Tout voir : zoom au minimum"
                    : `Zoom ×${level} : revenir à tout voir`
                }
                disabled={level === 1}
                data-testid="tl-zoom-reset"
                onClick={() => changeZoom(1)}
              >
                {level === 1 ? "Tout" : `×${level}`}
              </button>
              <button
                type="button"
                className="xt-icon"
                aria-label="Voir de plus près"
                disabled={level === levels[levels.length - 1]}
                data-testid="tl-zoom-in"
                onClick={() => changeZoom(stepZoom(level, 1, levels))}
              >
                <TIcon name="zoom-in" size={22} />
              </button>
            </div>
          ) : null}
        </header>
      )}

      <div
        ref={(node) => {
          scrollRef.current = node;
          return node ? overflowFade(node) : undefined;
        }}
        className="xt-scroll"
        tabIndex={level > 1 ? 0 : -1}
        role="group"
        aria-label={
          level > 1
            ? "Pistes de la chronologie : elles défilent de gauche à droite"
            : "Pistes de la chronologie"
        }
        data-testid="tl-scroll"
      >
        <div
          ref={tracksRef}
          className="xt-tracks"
          data-side="center"
          style={{ width: width || "100%" }}
        >
          {compact ? null : (
            <div
              className="xt-track xt-ruler"
              style={{ height: RULER_H }}
              data-testid="tl-ruler"
              {...scrub}
            >
              {marks.map((mark) => {
                const x = timeToPx(mark.t, duration, width);
                return (
                  <span key={mark.t} aria-hidden="true">
                    <i
                      className="xt-tick"
                      data-major={mark.major || undefined}
                      style={{ left: x }}
                    />
                    {mark.major ? (
                      <b
                        className="xt-tick-lab"
                        data-flip={x + TICK_LABEL_PX > width || undefined}
                        style={{ left: x }}
                      >
                        {mark.label}
                      </b>
                    ) : null}
                  </span>
                );
              })}
              <Bubble head={head} />
            </div>
          )}
          {compact ? null : (
            <PassageRow
              blocks={blocks}
              head={head}
              duration={duration}
              width={width}
            />
          )}
          <div
            className="xt-track xt-wave"
            style={{ height: WAVE_H }}
            aria-hidden="true"
            data-testid="tl-wave"
            {...scrub}
          >
            <span className="xt-lab">Onde</span>
            <WaveCanvas
              peaks={peaks}
              duration={duration}
              width={width}
              height={WAVE_H}
              layer="idle"
              included={included}
            />
            <div className="xt-played">
              <WaveCanvas
                peaks={peaks}
                duration={duration}
                width={width}
                height={WAVE_H}
                layer="played"
                included={included}
              />
            </div>
          </div>
          <div
            className="xt-track xt-film"
            style={{ height: FILM_H }}
            data-kind={film.kind}
            data-testid="tl-film"
          >
            <span className="xt-lab xt-lab--film">
              <Glyph name="film" />
              <span>
                {film.kind === "clip"
                  ? clipPillText(film.clip, segments)
                  : film.label}
              </span>
            </span>
            {film.kind === "clip" ? (
              <ClipTrack
                clip={film.clip}
                frames={film.frames}
                segments={segments}
                duration={duration}
                width={width}
                longest={longest}
                onSeam={() => setModesOpen((open) => !open)}
                onOffset={onOffset}
              />
            ) : (
              <div
                className="xt-film-still"
                aria-hidden="true"
                style={film.style ?? undefined}
              />
            )}
          </div>
          <div className="xt-head">
            <i className="xt-head-line" aria-hidden="true" />
            <HeadKnob
              head={head}
              duration={duration}
              onKey={keyOnHead}
              down={down}
              move={move}
              up={up}
            />
          </div>
        </div>
      </div>

      {level > 1 && !compact ? (
        <p className="xt-scroll-note" role="note" data-testid="tl-scroll-note">
          Zoom ×{level} : la chronologie défile. Glisse les passages pour
          avancer, glisse l’onde pour poser la tête de lecture.
        </p>
      ) : null}

      {compact ? null : (
        <div
          className="xt-ctl"
          role="group"
          aria-label="Déplacer la tête de lecture"
        >
          <button
            type="button"
            className="xt-btn"
            aria-label="Passage précédent"
            data-testid="tl-prev"
            onClick={() => jump(-1)}
          >
            <TIcon name="skip-prev" size={20} />
          </button>
          <button
            type="button"
            className="xt-btn"
            aria-label="Reculer de 1 seconde"
            data-testid="tl-back-1"
            {...back1}
          >
            <TIcon name="back" size={18} />
            <span aria-hidden="true">1 s</span>
          </button>
          <button
            type="button"
            className="xt-btn"
            aria-label="Reculer de 0,1 seconde"
            data-testid="tl-back-01"
            {...back01}
          >
            <TIcon name="back" size={18} />
            <span aria-hidden="true">0,1</span>
          </button>
          <button
            type="button"
            className="xt-btn"
            aria-label="Avancer de 0,1 seconde"
            data-testid="tl-fwd-01"
            {...fwd01}
          >
            <span aria-hidden="true">0,1</span>
            <TIcon name="forward" size={18} />
          </button>
          <button
            type="button"
            className="xt-btn"
            aria-label="Avancer de 1 seconde"
            data-testid="tl-fwd-1"
            {...fwd1}
          >
            <span aria-hidden="true">1 s</span>
            <TIcon name="forward" size={18} />
          </button>
          <button
            type="button"
            className="xt-btn"
            aria-label="Passage suivant"
            data-testid="tl-next"
            onClick={() => jump(1)}
          >
            <TIcon name="skip-next" size={20} />
          </button>
        </div>
      )}

      <FilmFoot
        film={film.kind === "clip" ? { kind: "clip", clip: film.clip } : film}
        longest={longest}
        parts={props.parts}
        compact={compact}
        modesOpen={modesOpen}
        onToggleModes={setModesOpen}
        onMode={(mode) => {
          if (film.kind !== "clip") return;
          props.onClip({ ...film.clip, mode });
          setModesOpen(false);
          props.announce(
            `Comportement de la vidéo de fond : ${MODE_NAME[mode]}.`,
          );
        }}
        onOffset={onOffset}
      />
    </section>
  );
}
