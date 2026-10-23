"use client";
import type { RefObject } from "react";
import { formatClockLength, formatTenths } from "@/lib/format";
import { formatTime, type Interval } from "@/lib/recognition";
import { ZOOM_SPANS } from "@/lib/timeline";
import { Icon } from "./icons";
import type { ReviewController } from "./use-review";
import { useClock, useStoreValue } from "./hooks";
import type { usePlayer } from "./use-player";
import { Timeline, type TimelineHandle } from "./timeline";

type Player = ReturnType<typeof usePlayer>;
/** Pas de saut du lecteur : valeur centrale unique, non réglable. */
export const SKIP_SECONDS = 5;
export type ListeningState = "pending" | "ready" | "fallback";

const LISTENING_BADGE: Record<
  ListeningState,
  { label: string; title: string }
> = {
  ready: {
    label: "Écoute = audio du moteur",
    title:
      "Audio décodé exactement comme le moteur l’a entendu (mono, 16 kHz) : les temps affichés et l’écoute coïncident à l’échantillon près.",
  },
  pending: {
    label: "Préparation de l’écoute…",
    title: "Décodage de l’audio comme le moteur, une seule fois par session.",
  },
  fallback: {
    label: "Original · position approximative",
    title:
      "Fichier original : dans un MP3 à débit variable, le navigateur peut se positionner à plusieurs secondes de l’instant demandé.",
  },
};

/** Lecteur : lecture/pause, ±5 s, position. Seul composant à suivre la position image par image. */
function Transport({
  player,
  duration,
  onDockMark,
  dockLabel,
}: {
  player: Player;
  duration: number;
  onDockMark: () => void;
  dockLabel: string;
}) {
  const time = useClock(player.store);
  const playing = useStoreValue(player.store, (s) => s.playing);
  const percent = duration > 0 ? (time / duration) * 100 : 0;
  return (
    <div className="transport" data-testid="transport">
      <button
        type="button"
        className="play"
        data-testid="play"
        aria-label={playing ? "Mettre en pause" : "Lancer la lecture"}
        onClick={player.toggle}
      >
        <Icon name={playing ? "pause" : "play"} fill />
      </button>
      <button
        type="button"
        className="seek"
        data-testid="seek-back"
        aria-label="Reculer de 5 secondes"
        data-tip="Reculer de 5 s  ←"
        onClick={() => player.skip(-SKIP_SECONDS)}
      >
        <Icon name="seek-back" className="five" />
      </button>
      <div className="scrub">
        <div className="times mono">
          <b data-testid="time-now">{formatTime(time)}</b>
          <span className="tm-total">{formatTime(duration)}</span>
        </div>
        <input
          type="range"
          min="0"
          max={duration || 1}
          step="0.01"
          value={Math.min(time, duration || 1)}
          aria-label="Position de lecture"
          aria-valuetext={`${formatClockLength(time)} sur ${formatClockLength(duration)}`}
          style={{ "--p": `${percent}%` } as React.CSSProperties}
          onChange={(event) => player.seek(Number(event.target.value))}
        />
      </div>
      <button
        type="button"
        className="seek"
        data-testid="seek-forward"
        aria-label="Avancer de 5 secondes"
        data-tip="Avancer de 5 s  →"
        onClick={() => player.skip(SKIP_SECONDS)}
      >
        <Icon name="seek-fwd" className="five" />
      </button>
      <button
        type="button"
        className="seek mark-dock"
        data-testid="dock-mark"
        aria-label={dockLabel}
        onClick={onDockMark}
      >
        <Icon name="flag" />
      </button>
      <label className="speed">
        <span className="sr">Vitesse de lecture</span>
        <select
          className="input"
          value={player.rate}
          onChange={(event) => player.setRate(Number(event.target.value))}
        >
          <option value="0.5">0,5×</option>
          <option value="0.75">0,75×</option>
          <option value="1">1×</option>
          <option value="1.25">1,25×</option>
          <option value="1.5">1,5×</option>
        </select>
      </label>
    </div>
  );
}

const LEGEND: { label: string; style: string }[] = [
  { label: "Reconnu", style: "s-recognized" },
  { label: "Déduit · non entendu", style: "s-inferred" },
  { label: "Incertain", style: "s-uncertain" },
  { label: "Formule", style: "s-formula" },
  { label: "Abstention", style: "s-abstention" },
];

type Props = {
  player: Player;
  duration: number;
  peaks: { duration: number; peaks: number[] } | null;
  listening: ListeningState;
  intervals: readonly Interval[];
  selectedIndex: number | null;
  onSelectInterval: (index: number) => void;
  timelineRef: RefObject<TimelineHandle | null>;
  span: number | null;
  onSpan: (span: number | null) => void;
  follow: boolean;
  onFollow: (follow: boolean) => void;
  /** Choix explicite de l'utilisateur (l'interrupteur) : c'est lui qui devient une préférence. */
  onFollowToggle: (follow: boolean) => void;
  review: ReviewController;
  /** Clic sur un signalement de l'onde ou de la piste Revue : le sélectionne et ouvre la liste. */
  onSelectAnnotation: (id: string) => void;
};

export function Console(props: Props) {
  const { review, player } = props;
  const marking = review.state.mark !== null;
  const status = marking ? (
    <>
      Début posé à <b>{formatTenths(review.state.mark as number)}</b> — appuie
      pour poser la fin.
    </>
  ) : review.trace ? (
    "Glisse sur l’onde pour tracer une plage, touche pour un point."
  ) : (
    "Appuie à la position de lecture, ou trace directement sur l’onde."
  );
  const badge = LISTENING_BADGE[props.listening];
  return (
    <section
      className="card console o-console"
      aria-label="Écoute et pistes synchronisées"
      data-testid="console"
    >
      <div className="console-head">
        <span className="eyebrow">Écoute de la source</span>
        <span
          className="player-badge"
          data-state={props.listening}
          data-testid="listening-badge"
          title={badge.title}
        >
          {badge.label}
        </span>
      </div>
      <Transport
        player={player}
        duration={props.duration}
        dockLabel={
          marking
            ? "Marquer la fin du signalement"
            : "Marquer le début d’un signalement"
        }
        onDockMark={review.press}
      />
      <div className="markbar" id="markbar">
        <button
          type="button"
          className={`btn btn--sm ${review.draft ? "btn--secondary" : "btn--primary"}`}
          data-testid="mark-button"
          onClick={review.press}
        >
          <Icon name="flag" />
          {marking ? "Marquer la fin" : "Marquer le début"} <kbd>M</kbd>
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          data-testid="trace-toggle"
          aria-pressed={review.trace}
          onClick={() => review.setTrace(!review.trace)}
        >
          Tracer sur l’onde
        </button>
        {marking ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="mark-cancel"
            onClick={review.cancel}
          >
            Annuler <kbd>Échap</kbd>
          </button>
        ) : null}
        <p className="mb-status" role="status" data-testid="mark-status">
          {status}
        </p>
      </div>
      <Timeline
        ref={props.timelineRef}
        duration={props.duration}
        peaks={props.peaks}
        intervals={props.intervals}
        selectedIndex={props.selectedIndex}
        onSelectInterval={props.onSelectInterval}
        store={player.store}
        onSeek={player.seek}
        span={props.span}
        follow={props.follow}
        onUserMove={() => props.onFollow(false)}
        annotations={review.visible}
        selectedAnnotationId={review.state.selectedId}
        draftId={review.state.draftId}
        mark={review.state.mark}
        trace={review.trace}
        onTrace={review.traceSelect}
        onEdge={review.edge}
        onNudge={review.nudge}
        onSelectAnnotation={props.onSelectAnnotation}
      />
      <div className="tools">
        <label>
          Fenêtre visible
          <select
            className="input"
            data-testid="span-select"
            value={props.span ?? ""}
            onChange={(event) =>
              props.onSpan(
                event.target.value ? Number(event.target.value) : null,
              )
            }
          >
            {ZOOM_SPANS.map((z) => (
              <option key={z.label} value={z.seconds ?? ""}>
                {z.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="switch"
          role="switch"
          data-testid="follow-switch"
          aria-checked={props.follow}
          onClick={() => props.onFollowToggle(!props.follow)}
        >
          <i />
          Suivre la lecture
        </button>
        <label className="hide-sm">
          Volume
          <input
            className="vol"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={player.volume}
            aria-label="Volume"
            style={{ "--p": `${player.volume * 100}%` } as React.CSSProperties}
            onChange={(event) => player.setVolume(Number(event.target.value))}
          />
        </label>
      </div>
      <ul
        className="legend"
        aria-label="Légende des intervalles (forme, motif et libellé : jamais la couleur seule)"
      >
        {LEGEND.map((entry) => (
          <li key={entry.label}>
            <span className={`sw ${entry.style}`} />
            {entry.label}
          </li>
        ))}
        <li>
          <span className="sw s-human">
            <i />
          </span>
          Signalement confirmé
        </li>
        <li>
          <span className="sw s-human draft">
            <i />
          </span>
          Brouillon
        </li>
      </ul>
    </section>
  );
}
