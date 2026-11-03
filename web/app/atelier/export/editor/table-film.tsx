"use client";
import {
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  formatClockTenths,
  keyboardOffset,
  MODE_CHOICES,
  nudgeOffset,
  portionView,
} from "@/lib/background-video-view";
import {
  filmPill,
  offsetFromFilmDrag,
  timeToPx,
  type FilmSegment,
} from "@/lib/export-table-timeline";
import { spokenTime } from "@/lib/export-timeline";
import type { BackgroundVideoMode } from "@/lib/export-video-model";
import { describeFit, formatSeconds } from "@/lib/export-video-vtime";
import {
  Cells,
  FilmBand,
  frameVars,
  Glyph,
  type BackgroundVideoValue,
} from "../background-video-view";
import { rovingKeys } from "../export-ui";
import { useHoldRepeat } from "./controls";

/**
 * La piste « Fond » de la chronologie et ses explications. Ce que la vidéo de fond fait sous CHAQUE plage
 * exportée (une plage = une vidéo, et la vidéo repart de son propre début) :
 *  - plus courte : elle se répète ; un repère ⟲ marque chaque raccord, et le toucher ouvre le choix du
 *    comportement (recommencer, aller-retour, dernière image, ralenti) ;
 *  - plus longue : on fait glisser la bande SOUS la récitation pour choisir la portion (valeurs écrites,
 *    boutons ± 0,1 s et ± 1 s, clavier) ;
 *  - même durée : rien à régler.
 * Tout le calcul est dans `lib/export-table-timeline.ts` et `lib/background-video-view.ts`.
 */

type Clip = BackgroundVideoValue;
type Frames = ReadonlyArray<string | null>;

const SEAM_GLYPH: Record<BackgroundVideoMode, "loop" | "pingpong" | "freeze"> =
  { loop: "loop", pingpong: "pingpong", freeze: "freeze", slow: "loop" };

const SEAM_SAYS: Record<BackgroundVideoMode, string> = {
  loop: "La vidéo recommence",
  pingpong: "La vidéo repart en arrière",
  freeze: "La vidéo s’arrête sur sa dernière image",
  slow: "La vidéo",
};

/** La partie de la vidéo choisie : la bande glisse sous la récitation. */
function PortionSlider({
  segment,
  index,
  clip,
  frames,
  longest,
  pxPerSecond,
  onOffset,
}: {
  segment: FilmSegment;
  index: number;
  clip: Clip;
  frames: Frames;
  longest: number;
  pxPerSecond: number;
  onOffset: (offset: number, announce: boolean) => void;
}) {
  const span = { videoDuration: clip.duration, audioDuration: longest };
  const view = portionView({ ...span, offset: clip.offset, mode: clip.mode });
  const drag = useRef<{ x: number; offset: number } | null>(null);
  const from = segment.portion?.from ?? 0;

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, offset: clip.offset };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d)
      onOffset(
        offsetFromFilmDrag(d.offset, event.clientX - d.x, pxPerSecond, span),
        false,
      );
  };
  const up = () => {
    drag.current = null;
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = keyboardOffset(event.key, event.shiftKey, clip.offset, span);
    if (next === null) return;
    event.preventDefault();
    onOffset(next, true);
  };
  const filmStyle: CSSProperties = {
    left: -from * pxPerSecond,
    width: clip.duration * pxPerSecond,
  };
  return (
    <div
      className="xt-slide"
      role="slider"
      tabIndex={0}
      aria-label={`Partie de la vidéo de fond sous la plage ${index + 1} : fais-la glisser`}
      aria-valuemin={0}
      aria-valuemax={view.max}
      aria-valuenow={view.from}
      aria-valuetext={view.valueText}
      data-testid="tl-film-slider"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <div className="xt-slide-film bvs-film" style={filmStyle}>
        <i className="bvs-tile" style={{ left: 0, width: "100%" }}>
          <Cells frames={frames} />
        </i>
      </div>
    </div>
  );
}

/** Le contenu de la piste « Fond » quand une vidéo de fond est choisie : un segment par plage exportée. */
export function ClipTrack({
  clip,
  frames,
  segments,
  duration,
  width,
  longest,
  onSeam,
  onOffset,
}: {
  clip: Clip;
  frames: Frames;
  segments: readonly FilmSegment[];
  duration: number;
  width: number;
  longest: number;
  onSeam: () => void;
  onOffset: (offset: number, announce: boolean) => void;
}) {
  const pxPerSecond = duration > 0 ? width / duration : 0;
  return (
    <div className="xt-film-clip" style={frameVars(frames)}>
      {segments.map((segment, index) => {
        const left = timeToPx(segment.start, duration, width);
        const w = Math.max(2, timeToPx(segment.end, duration, width) - left);
        const label = `Vidéo de fond sous la plage ${index + 1}. ${segment.fit.text}`;
        const { situation } = segment.fit;
        return (
          <div
            key={segment.id}
            className="xt-seg"
            data-situation={situation}
            style={{ left, width: w }}
          >
            {situation === "shorter" || situation === "same" ? (
              <FilmBand
                view={segment.film}
                frames={frames}
                label={label}
                seamButtons={
                  situation === "shorter"
                    ? {
                        glyph: SEAM_GLYPH[clip.mode],
                        label: (i) =>
                          `${SEAM_SAYS[clip.mode]} à ${spokenTime(segment.film.seamTimes[i] ?? 0)} de la plage ${index + 1}. Changer ce que fait la vidéo.`,
                        onPress: onSeam,
                      }
                    : undefined
                }
              />
            ) : situation === "longer" ? (
              <PortionSlider
                segment={segment}
                index={index}
                clip={clip}
                frames={frames}
                longest={longest}
                pxPerSecond={pxPerSecond}
                onOffset={onOffset}
              />
            ) : (
              <div className="xt-film-plain" role="img" aria-label={label} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Ce que dit la pastille collée à gauche de la piste « Fond ». */
export function clipPillText(
  clip: Clip,
  segments: readonly FilmSegment[],
): string {
  const [first] = segments;
  const text =
    segments.length === 0
      ? ""
      : segments.length === 1
        ? filmPill(first, clip)
        : "selon chaque plage";
  return text ? `${clip.name} · ${text}` : clip.name;
}

// ── le pied de la chronologie : ce que fait la vidéo, en clair, et de quoi la régler ────────────

const MODE_SHORT: Record<BackgroundVideoMode, string> = {
  loop: "Recommencer",
  pingpong: "Aller-retour",
  freeze: "Dernière image",
  slow: "Ralentir",
};

/** Le choix du comportement, ouvert par un repère ⟲ : quatre boutons de 44 px, une seule réponse. */
function ModePicker({
  mode,
  onMode,
  onClose,
}: {
  mode: BackgroundVideoMode;
  onMode: (mode: BackgroundVideoMode) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="xt-modes"
      data-testid="tl-modes"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <p className="xt-modes-q" id="xt-modes-q">
        Quand la vidéo arrive à sa fin, elle…
      </p>
      <div
        className="xt-modes-row"
        role="radiogroup"
        aria-labelledby="xt-modes-q"
        onKeyDown={rovingKeys}
      >
        {MODE_CHOICES.map((choice) => (
          <button
            key={choice.mode}
            type="button"
            role="radio"
            className="xt-mode"
            aria-checked={choice.mode === mode}
            tabIndex={choice.mode === mode ? 0 : -1}
            data-mode={choice.mode}
            data-testid={`tl-mode-${choice.mode}`}
            title={choice.hint}
            onClick={() => onMode(choice.mode)}
          >
            <Glyph name={choice.mode} />
            <span>{MODE_SHORT[choice.mode]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Les boutons ± 0,1 s et ± 1 s de la portion : l'alternative au glisser. */
function PortionNudges({
  clip,
  longest,
  onOffset,
}: {
  clip: Clip;
  longest: number;
  onOffset: (offset: number, announce: boolean) => void;
}) {
  const span = { videoDuration: clip.duration, audioDuration: longest };
  const latest = useRef(clip.offset);
  latest.current = clip.offset;
  const step = (delta: number) => {
    const next = nudgeOffset(latest.current, delta, span);
    if (next === latest.current) return false;
    latest.current = next;
    onOffset(next, true);
    return true;
  };
  const back1 = useHoldRepeat(() => step(-1));
  const back01 = useHoldRepeat(() => step(-0.1));
  const fwd01 = useHoldRepeat(() => step(0.1));
  const fwd1 = useHoldRepeat(() => step(1));
  const buttons = [
    { label: "Reculer de 1 s", text: "1 s", left: true, hold: back1 },
    { label: "Reculer de 0,1 s", text: "0,1 s", left: true, hold: back01 },
    { label: "Avancer de 0,1 s", text: "0,1 s", left: false, hold: fwd01 },
    { label: "Avancer de 1 s", text: "1 s", left: false, hold: fwd1 },
  ];
  return (
    <div
      className="xt-nudges"
      role="group"
      aria-label="Décaler la partie de la vidéo de fond"
    >
      {buttons.map((b) => (
        <button
          key={b.label}
          type="button"
          className="xt-btn"
          aria-label={b.label}
          data-testid={`tl-nudge-${b.label.replace(/\W+/g, "-").toLowerCase()}`}
          {...b.hold}
        >
          {b.left ? <Glyph name="left" /> : null}
          <span aria-hidden="true">{b.text}</span>
          {b.left ? null : <Glyph name="right" />}
        </button>
      ))}
    </div>
  );
}

export function FilmFoot({
  film,
  longest,
  parts,
  compact,
  modesOpen,
  onToggleModes,
  onMode,
  onOffset,
}: {
  film:
    | { kind: "clip"; clip: Clip }
    | { kind: "still"; label: string; source: boolean };
  longest: number;
  parts: number;
  compact: boolean;
  modesOpen: boolean;
  onToggleModes: (open: boolean) => void;
  onMode: (mode: BackgroundVideoMode) => void;
  onOffset: (offset: number, announce: boolean) => void;
}) {
  if (film.kind === "still")
    return (
      <div className="xt-foot" data-testid="tl-foot">
        <p className="xt-foot-text">
          {film.source
            ? "La vidéo d’origine défile avec la récitation, telle quelle."
            : "Image fixe sur toute la durée."}
        </p>
      </div>
    );
  const { clip } = film;
  const input = {
    videoDuration: clip.duration,
    audioDuration: longest,
    offset: clip.offset,
    mode: clip.mode,
  };
  const fit = describeFit(input);
  const view = portionView(input);
  return (
    <div className="xt-foot" data-testid="tl-foot">
      {fit.situation === "longer" ? (
        <>
          <p className="xt-foot-text" data-testid="tl-foot-text">
            Partie utilisée :{" "}
            <b>
              {formatClockTenths(view.from)} → {formatClockTenths(view.to)}
            </b>{" "}
            sur {formatClockTenths(clip.duration)}. Fais glisser la bande sous
            la récitation.
            {parts > 1 ? ` Le même départ vaut pour les ${parts} plages.` : ""}
            <span className="xt-map" aria-hidden="true">
              <i
                style={{
                  left: `${view.leftPct}%`,
                  width: `${view.widthPct}%`,
                }}
              />
            </span>
          </p>
          {compact ? null : (
            <PortionNudges clip={clip} longest={longest} onOffset={onOffset} />
          )}
        </>
      ) : (
        <p className="xt-foot-text" data-testid="tl-foot-text">
          {fit.text}
          {fit.situation === "shorter" ? (
            <>
              {" "}
              Touche <Glyph name="loop" /> pour changer.
            </>
          ) : null}
          {fit.situation === "shorter" && parts > 1 ? (
            <> Chaque plage recommence la vidéo depuis son début.</>
          ) : null}
        </p>
      )}
      {fit.situation === "shorter" && modesOpen ? (
        <ModePicker
          mode={clip.mode}
          onMode={onMode}
          onClose={() => onToggleModes(false)}
        />
      ) : null}
      <p className="sr" data-testid="tl-film-sr">
        {formatSeconds(clip.duration)} de vidéo, {formatSeconds(longest)} de
        récitation.
      </p>
    </div>
  );
}
