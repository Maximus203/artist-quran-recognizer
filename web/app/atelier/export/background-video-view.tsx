"use client";
import "../../background-video.css";
import {
  useRef,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from "react";
import { isBusy, progressLabel, type Flow } from "@/lib/background-video-flow";
import {
  CLIP_ACCEPT,
  clipLimitsText,
  type ClipLimits,
} from "@/lib/background-video-policy";
import {
  filmView,
  formatClockTenths,
  keyboardOffset,
  MODE_CHOICES,
  nudgeOffset,
  offsetFromDrag,
  offsetFromTap,
  portionView,
  presetOffset,
  seamsText,
  statusText,
  type FilmView,
} from "@/lib/background-video-view";
import type { BackgroundVideoMode } from "@/lib/export-video-model";
import { describeFit, formatSeconds } from "@/lib/export-video-vtime";
import { rovingKeys } from "./export-ui";

/**
 * Section « Vidéo de fond » : choisir sa vidéo, voir (et lire en clair) ce qu'elle fera sous la récitation,
 * régler la boucle ou la portion. Cette vue est PRÉSENTATIONNELLE : tout l'état arrive par les propriétés, les
 * gestes remontent par les rappels. L'envoi et la lecture des faits sont dans `background-video-section.tsx`.
 */
export type BackgroundVideoValue = {
  /** Le fichier lu pour l'aperçu : le fichier choisi, ou la copie préparée par le serveur si le navigateur ne lit pas l'original. */
  file: File;
  /** Identifiant de la vidéo prête sur le serveur : c'est lui que l'export désigne (`background.video.upload_id`). */
  uploadId: string;
  /** Nom affiché. */
  name: string;
  /** Durée (s), largeur et hauteur (px) de la vidéo. */
  duration: number;
  width: number;
  height: number;
  /** Départ dans la vidéo (s) quand elle est plus longue que la récitation : un seul pour toutes les parties. */
  offset: number;
  /** Ce qu'elle fait quand elle est plus courte. */
  mode: BackgroundVideoMode;
};

export type OffsetSource = "slider" | "pointer" | "button";

export type BackgroundVideoViewProps = {
  flow: Flow;
  value: BackgroundVideoValue | null;
  limits: ClipLimits;
  /** Durée (s) de la récitation exportée la plus longue. */
  recitationSeconds: number;
  /** Nombre de parties exportées (un seul départ vaut pour toutes). */
  parts: number;
  /** Vignettes de la bande « film » (cases vides tant qu'elles ne sont pas prêtes). */
  frames: ReadonlyArray<string | null>;
  /** Annonce pour lecteur d'écran (région vivante polie). */
  announcement: string;
  onPick: (file: File) => void;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onMode: (mode: BackgroundVideoMode) => void;
  onOffset: (offset: number, source: OffsetSource) => void;
};

// ── pictogrammes dessinés pour le projet (trait 1,6 px, bouts ronds) ───────────────────────────

const PATHS = {
  film: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="M8 5v14M16 5v14M3.5 9.5H8M3.5 14.5H8M16 9.5h4.5M16 14.5h4.5" />
    </>
  ),
  loop: (
    <>
      <path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H17" />
      <path d="M14.5 4.5L17 7l-2.5 2.5" />
      <path d="M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H7" />
      <path d="M9.5 19.5L7 17l2.5-2.5" />
    </>
  ),
  pingpong: <path d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" />,
  freeze: (
    <>
      <path d="M5 12h9" />
      <path d="M11 8.5l3.5 3.5-3.5 3.5" />
      <path d="M19 6v12" />
    </>
  ),
  slow: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  left: <path d="M14.5 6l-6 6 6 6" />,
  right: <path d="M9.5 6l6 6-6 6" />,
  mute: (
    <>
      <path d="M4.5 9.5h3l4-3.5v12l-4-3.5h-3z" />
      <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 15.5H3z" />
      <path d="M12 10v4.2M12 17v.01" />
    </>
  ),
} satisfies Record<string, ReactNode>;

function Glyph({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg
      className="bvs-i"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

// ── choix du fichier ──────────────────────────────────────────────────────────────────────────

/** Bouton de choix de fichier : un `<label>` qui porte un champ fichier (focus clavier et lecteur d'écran compris). */
function FilePicker({
  children,
  onPick,
  tone = "primary",
}: {
  children: ReactNode;
  onPick: (file: File) => void;
  tone?: "primary" | "plain";
}) {
  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // choisir deux fois le même fichier doit relancer la lecture
    if (file) onPick(file);
  };
  return (
    <label className={`bvs-btn bvs-btn--${tone}`}>
      <input
        className="bvs-file-input"
        type="file"
        accept={CLIP_ACCEPT}
        onChange={change}
        data-testid="bvs-input"
      />
      <span>{children}</span>
    </label>
  );
}

// ── bande « film » ────────────────────────────────────────────────────────────────────────────

const frameVars = (frames: ReadonlyArray<string | null>): CSSProperties => {
  const vars: Record<string, string> = {};
  frames.forEach((url, i) => {
    if (url) vars[`--f${i}`] = `url("${url}")`;
  });
  return vars as CSSProperties;
};

/** Les cases d'une tuile : les vignettes dans l'ordre de la vidéo, ou une case hachurée tant qu'il n'y en a pas. */
function Cells({ frames }: { frames: ReadonlyArray<string | null> }) {
  const count = Math.max(1, frames.length);
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <u
          key={i}
          style={frames[i] ? { backgroundImage: `var(--f${i})` } : undefined}
        />
      ))}
    </>
  );
}

function FilmBand({
  view,
  frames,
  label,
}: {
  view: FilmView;
  frames: ReadonlyArray<string | null>;
  label: string;
}) {
  return (
    <div
      className="bvs-film"
      role="img"
      aria-label={label}
      style={frameVars(frames)}
      data-testid="bvs-film"
    >
      {view.tiles.map((tile, i) => (
        <i
          key={i}
          className="bvs-tile"
          data-flip={tile.flipped || undefined}
          style={{ left: `${tile.left}%`, width: `${tile.width}%` }}
        >
          <Cells frames={frames} />
        </i>
      ))}
      {view.dense ? (
        <i
          className="bvs-tile bvs-tile--dense"
          style={{ ["--tile" as string]: `${view.tileWidth}%` }}
        />
      ) : null}
      {view.frozen ? (
        <i
          className="bvs-frozen"
          style={{
            left: `${view.frozen.left}%`,
            width: `${view.frozen.width}%`,
          }}
        >
          Image figée
        </i>
      ) : null}
      {view.seams.map((seam, i) => (
        <b
          key={i}
          className="bvs-seam"
          style={{ left: `${seam}%` }}
          aria-hidden="true"
        >
          <Glyph name="loop" />
        </b>
      ))}
    </div>
  );
}

/** Petit schéma d'un comportement, à l'échelle de CETTE vidéo sous CETTE récitation. */
function Diagram({
  mode,
  videoDuration,
  audioDuration,
}: {
  mode: BackgroundVideoMode;
  videoDuration: number;
  audioDuration: number;
}) {
  const view = filmView({ videoDuration, audioDuration, offset: 0, mode });
  return (
    <span className="bvs-diagram" aria-hidden="true">
      {view.dense ? (
        <i data-kind="dense" style={{ flex: 1 }} />
      ) : (
        view.tiles.map((tile, i) => (
          <i
            key={i}
            data-kind={tile.flipped ? "flip" : "clip"}
            style={{ flex: tile.width }}
          />
        ))
      )}
      {view.frozen ? (
        <i data-kind="frozen" style={{ flex: view.frozen.width }} />
      ) : null}
    </span>
  );
}

// ── éditeur de portion (vidéo plus longue) ────────────────────────────────────────────────────

function PortionEditor({
  value,
  recitationSeconds,
  frames,
  onOffset,
}: {
  value: BackgroundVideoValue;
  recitationSeconds: number;
  frames: ReadonlyArray<string | null>;
  onOffset: (offset: number, source: OffsetSource) => void;
}) {
  const span = {
    videoDuration: value.duration,
    audioDuration: recitationSeconds,
  };
  const view = portionView({ ...span, offset: value.offset, mode: value.mode });
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; offset: number; width: number } | null>(
    null,
  );

  const down = (event: PointerEvent<HTMLDivElement>) => {
    const track = strip.current;
    if (!track) return;
    track.setPointerCapture(event.pointerId);
    const rect = track.getBoundingClientRect();
    let start = value.offset;
    // Toucher à côté de la fenêtre la recentre là ; la saisir permet de la faire glisser.
    if (!(event.target as Element).closest(".bvs-window")) {
      start = offsetFromTap(event.clientX - rect.left, rect.width, span);
      onOffset(start, "pointer");
    }
    drag.current = { x: event.clientX, offset: start, width: rect.width };
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d)
      onOffset(
        offsetFromDrag(d.offset, event.clientX - d.x, d.width, span),
        "pointer",
      );
  };
  const up = () => {
    drag.current = null;
  };
  const key = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const next = keyboardOffset(event.key, event.shiftKey, value.offset, span);
    if (next === null) return;
    event.preventDefault();
    onOffset(next, "slider");
  };
  const presets = [
    { id: "start", label: "Début de la vidéo" },
    { id: "middle", label: "Milieu" },
    { id: "end", label: "Fin de la vidéo" },
  ] as const;
  const nudges = [
    { delta: -1, label: "Reculer de 1 s", text: "1 s", side: "left" },
    { delta: -0.1, label: "Reculer de 0,1 s", text: "0,1 s", side: "left" },
    { delta: 0.1, label: "Avancer de 0,1 s", text: "0,1 s", side: "right" },
    { delta: 1, label: "Avancer de 1 s", text: "1 s", side: "right" },
  ] as const;
  const cells = Math.max(1, frames.length) || 12;

  return (
    <div className="bvs-portion" data-testid="bvs-portion">
      <div className="bvs-times">
        <span>
          Début <b>{formatClockTenths(view.from)}</b>
        </span>
        <span>
          Fin <b>{formatClockTenths(view.to)}</b>
        </span>
      </div>
      <div
        ref={strip}
        className="bvs-strip"
        style={frameVars(frames)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        data-testid="bvs-strip"
      >
        <div className="bvs-cells" aria-hidden="true">
          {Array.from({ length: cells }, (_, i) => (
            <u
              key={i}
              style={
                frames[i] ? { backgroundImage: `var(--f${i})` } : undefined
              }
            />
          ))}
        </div>
        <div
          className="bvs-window"
          role="slider"
          tabIndex={0}
          aria-label="Début de la portion choisie"
          aria-valuemin={0}
          aria-valuemax={view.max}
          aria-valuenow={view.from}
          aria-valuetext={view.valueText}
          data-narrow={view.narrow || undefined}
          data-right={view.leftPct > 60 || undefined}
          style={{ left: `${view.leftPct}%`, width: `${view.widthPct}%` }}
          onKeyDown={key}
          data-testid="bvs-window"
        >
          <span className="bvs-window-tag">{formatClockTenths(view.from)}</span>
        </div>
      </div>
      <p className="bvs-scale" aria-hidden="true">
        <span>0:00</span>
        <span>{formatClockTenths(value.duration)}</span>
      </p>
      <svg
        className="bvs-link"
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d={`M${view.leftPct} 0 L${view.leftPct + view.widthPct} 0 L100 30 L0 30 Z`}
        />
      </svg>
      <div className="bvs-recit" aria-hidden="true">
        <i />
      </div>
      <p className="bvs-scale">
        <span>Ta récitation</span>
        <span>{formatClockTenths(recitationSeconds)} · du début à la fin</span>
      </p>
      <div className="bvs-nudges" role="group" aria-label="Décaler la portion">
        {nudges.map((n) => (
          <button
            key={n.label}
            type="button"
            className="bvs-btn"
            aria-label={n.label}
            onClick={() =>
              onOffset(nudgeOffset(value.offset, n.delta, span), "button")
            }
          >
            {n.side === "left" ? <Glyph name="left" /> : null}
            <span aria-hidden="true">{n.text}</span>
            {n.side === "right" ? <Glyph name="right" /> : null}
          </button>
        ))}
      </div>
      <div className="bvs-chips" role="group" aria-label="Aller à">
        {presets.map((p) => {
          const target = presetOffset(p.id, span);
          return (
            <button
              key={p.id}
              type="button"
              className="bvs-btn bvs-chip"
              aria-pressed={Math.abs(target - view.from) < 0.05}
              onClick={() => onOffset(target, "button")}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── la vue ────────────────────────────────────────────────────────────────────────────────────

export function BackgroundVideoView(props: BackgroundVideoViewProps) {
  const { flow, value, limits, recitationSeconds, parts, frames } = props;
  const active = isBusy(flow)
    ? (flow as Extract<Flow, { phase: "reading" | "sending" | "preparing" }>)
    : null;
  const input = {
    videoDuration: value?.duration ?? 0,
    audioDuration: recitationSeconds,
    offset: value?.offset ?? 0,
    mode: value?.mode ?? ("loop" as const),
  };
  const fit = describeFit(input);

  return (
    <section
      className="bvs"
      aria-labelledby="bvs-title"
      data-testid="background-video"
      data-phase={flow.phase}
    >
      <h3 id="bvs-title" className="bvs-title">
        Vidéo de fond
      </h3>

      {flow.phase === "idle" && !value ? (
        <>
          <p className="bvs-lead">
            Une vidéo qui joue derrière le texte, à la place de l’image.
          </p>
          <div className="bvs-actions">
            <FilePicker onPick={props.onPick}>Ma vidéo…</FilePicker>
          </div>
          <p className="bvs-limits">{clipLimitsText(limits)}</p>
        </>
      ) : null}

      {active ? (
        <div className="bvs-busy" data-testid="bvs-busy">
          <p className="bvs-name">
            <Glyph name="film" />
            <b>{active.fileName}</b>
          </p>
          {active.phase !== "reading" ? (
            <div
              className="bvs-bar"
              role="progressbar"
              aria-label="Avancement de la vidéo de fond"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(active.ratio * 100)}
              aria-valuetext={progressLabel(active)}
            >
              <i style={{ width: `${Math.round(active.ratio * 100)}%` }} />
            </div>
          ) : null}
          <p className="bvs-progress">{progressLabel(active)}</p>
          <div className="bvs-actions">
            <button type="button" className="bvs-btn" onClick={props.onCancel}>
              Annuler
            </button>
          </div>
        </div>
      ) : null}

      {flow.phase === "failed" ? (
        <div className="bvs-error" role="alert" data-testid="bvs-error">
          <p className="bvs-error-title">
            <Glyph name="alert" />
            <b>La vidéo de fond n’a pas pu être utilisée</b>
          </p>
          <p className="bvs-error-text">{flow.error.message}</p>
          <div className="bvs-actions">
            {flow.error.resumeId ? (
              <>
                <button
                  type="button"
                  className="bvs-btn bvs-btn--primary"
                  onClick={props.onRetry}
                >
                  Reprendre l’envoi
                </button>
                <button
                  type="button"
                  className="bvs-btn"
                  onClick={props.onCancel}
                >
                  Abandonner
                </button>
              </>
            ) : (
              <>
                <FilePicker onPick={props.onPick}>
                  Choisir une autre vidéo
                </FilePicker>
                <button
                  type="button"
                  className="bvs-btn"
                  onClick={props.onCancel}
                >
                  Fermer
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {value && flow.phase === "ready" ? (
        <>
          <div className="bvs-file">
            <span className="bvs-file-ic">
              <Glyph name="film" />
            </span>
            <span className="bvs-file-meta">
              <b>{value.name}</b>
              <small>
                {value.duration > 0
                  ? formatSeconds(value.duration)
                  : "durée inconnue"}
                {value.width > 0 ? ` · ${value.width}×${value.height}` : ""}
              </small>
            </span>
            <span className="bvs-file-actions">
              <FilePicker onPick={props.onPick} tone="plain">
                Changer
              </FilePicker>
              <button
                type="button"
                className="bvs-btn"
                onClick={props.onRemove}
              >
                Retirer
              </button>
            </span>
          </div>
          <p className="bvs-mute">
            <Glyph name="mute" />
            <span>
              La vidéo de fond est muette : seul le son de la récitation est
              exporté.
            </span>
          </p>
          <p
            className="bvs-status"
            data-testid="bvs-status"
            data-situation={fit.situation}
          >
            {statusText(input, parts)}
          </p>
          <p className="bvs-numbers">
            Vidéo : {value.duration > 0 ? formatSeconds(value.duration) : "—"}
            {" · "}Récitation : {formatSeconds(recitationSeconds)}
          </p>

          {fit.situation === "shorter" ||
          fit.situation === "same" ||
          fit.situation === "unknown" ? (
            <>
              {fit.situation !== "unknown" ? (
                <>
                  <FilmBand
                    view={filmView(input)}
                    frames={frames}
                    label={`La vidéo sur la durée de la récitation. ${fit.text}`}
                  />
                  <p className="bvs-sr">
                    {seamsText(filmView(input).seamTimes)}
                  </p>
                  <p className="bvs-scale" aria-hidden="true">
                    <span>0:00</span>
                    <span>{formatClockTenths(recitationSeconds)}</span>
                  </p>
                </>
              ) : null}
            </>
          ) : null}

          {fit.situation === "shorter" ? (
            <div className="bvs-field">
              <p className="bvs-label" id="bvs-modes-label">
                Quand la vidéo arrive à sa fin
              </p>
              <div
                className="bvs-modes"
                role="radiogroup"
                aria-labelledby="bvs-modes-label"
                onKeyDown={rovingKeys}
              >
                {MODE_CHOICES.map((choice) => (
                  <button
                    key={choice.mode}
                    type="button"
                    role="radio"
                    className="bvs-mode bvs-btn"
                    aria-checked={choice.mode === value.mode}
                    tabIndex={choice.mode === value.mode ? 0 : -1}
                    data-mode={choice.mode}
                    onClick={() => props.onMode(choice.mode)}
                  >
                    <span className="bvs-mode-ic">
                      <Glyph name={choice.mode} />
                    </span>
                    <b>{choice.title}</b>
                    <small>{choice.hint}</small>
                    <Diagram
                      mode={choice.mode}
                      videoDuration={value.duration}
                      audioDuration={recitationSeconds}
                    />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {fit.situation === "longer" ? (
            <PortionEditor
              value={value}
              recitationSeconds={recitationSeconds}
              frames={frames}
              onOffset={props.onOffset}
            />
          ) : null}
        </>
      ) : null}

      <p className="bvs-live" aria-live="polite" role="status">
        {props.announcement}
      </p>
    </section>
  );
}
