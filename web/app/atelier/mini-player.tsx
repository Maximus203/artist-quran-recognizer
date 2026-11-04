"use client";
import Link from "next/link";
import { useLayoutEffect } from "react";
import { formatClockLength } from "@/lib/format";
import { useClock, useStoreValue } from "./hooks";
import { Icon } from "./icons";
import { announceMiniPlayer } from "./mini-reserve";
import type { usePlayer } from "./use-player";

/**
 * Le lecteur réduit, en bas de toute page connectée : tant qu'un audio est chargé et que la page ne montre
 * pas déjà ses commandes (Lecture, playlist), on peut le mettre en pause, le reprendre, l'ouvrir ou l'arrêter.
 */
export function MiniPlayer({
  player,
  audioId,
  label,
  onStop,
}: {
  player: ReturnType<typeof usePlayer>;
  audioId: string;
  label: string;
  onStop: () => void;
}) {
  const playing = useStoreValue(player.store, (s) => s.playing);
  const duration = useStoreValue(player.store, (s) => s.duration);
  const time = useClock(player.store);
  // Tant qu'il est là, il le dit à la racine : les pages « plein écran » lui laissent sa place (`--mini-reserve`).
  useLayoutEffect(() => announceMiniPlayer(document.documentElement), []);
  return (
    <div
      className="mini-player"
      role="region"
      aria-label="Lecteur audio"
      data-testid="mini-player"
    >
      <button
        type="button"
        className="mini-player-play"
        data-testid="mini-play"
        aria-label={playing ? "Mettre en pause" : "Lire"}
        onClick={player.toggle}
      >
        <Icon name={playing ? "pause" : "play"} fill />
      </button>
      <Link
        className="mini-player-title"
        href={`/?session=${audioId}`}
        data-testid="mini-open"
        title="Ouvrir dans la lecture"
      >
        {label}
      </Link>
      <span className="mono mini-player-time">
        {formatClockLength(time)} / {formatClockLength(duration)}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        data-testid="mini-stop"
        aria-label="Arrêter et fermer le lecteur"
        onClick={onStop}
      >
        <Icon name="x" />
      </button>
    </div>
  );
}
