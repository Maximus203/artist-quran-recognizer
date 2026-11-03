"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { movePlayhead } from "@/lib/export-table-timeline";
import { neighbourTarget } from "@/lib/export-timeline";
import { createStore, type Store } from "@/lib/mini-store";

/**
 * La tête de lecture de la table de montage : l'instant de la récitation que l'aperçu montre.
 *
 * Deux valeurs, pour deux rythmes. `store` (magasin observable) bouge à chaque image, pendant un glisser comme
 * pendant la lecture : seuls la ligne, la bulle et l'onde qui la lisent se redessinent, pas tout l'éditeur.
 * `at` est l'instant que l'aperçu IMMOBILE dessine : il suit le magasin sans dépasser une mise à jour par image
 * d'écran (un glisser rapide ne demande pas cent dessins de plus à l'aperçu).
 *
 * Pendant la lecture animée de l'aperçu, c'est l'aperçu qui mène (`onTime`) ; toucher la tête la ramène au
 * doigt en arrêtant la lecture (`stopToken`).
 */
export type Playhead = {
  store: Store<number>;
  /** L'instant montré par l'aperçu à l'arrêt. */
  at: number;
  playing: boolean;
  /** Change quand une lecture doit s'arrêter parce que la tête vient d'être déplacée à la main. */
  stopToken: number;
  /** Pose la tête (bornée, au dixième) ; renvoie l'instant posé. */
  seek: (t: number) => number;
  /** Déplace la tête de `delta` secondes ; renvoie l'instant posé. */
  nudge: (delta: number) => number;
  /** Va au repère voisin (début d'un passage) ; `null` s'il n'y en a plus dans ce sens. */
  jump: (direction: -1 | 1) => number | null;
  /** À brancher sur l'aperçu : l'instant lu, à chaque image de la lecture animée. */
  onTime: (t: number) => void;
  onPlayingChange: (playing: boolean) => void;
};

export function usePlayhead({
  duration,
  initial,
  targets,
}: {
  duration: number;
  /** Où la tête est posée à l'ouverture. */
  initial: number;
  /** Les repères où sauter (débuts de passages). */
  targets: readonly number[];
}): Playhead {
  const [store] = useState(() => createStore(initial));
  const [at, setAt] = useState(initial);
  const [playing, setPlaying] = useState(false);
  const [stopToken, setStopToken] = useState(0);
  const playingRef = useRef(false);
  const handOver = useRef(false);
  const pending = useRef(initial);
  const frame = useRef(0);
  const latest = useRef({ duration, targets });
  latest.current = { duration, targets };

  const commit = useCallback((t: number) => {
    pending.current = t;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setAt(pending.current);
    });
  }, []);
  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const seek = useCallback(
    (t: number) => {
      const next = movePlayhead(t, 0, latest.current.duration);
      if (playingRef.current) {
        // L'aperçu s'arrête (il rend un dernier instant en s'arrêtant : on ne l'écoute plus).
        handOver.current = true;
        setStopToken((n) => n + 1);
      }
      store.set(next);
      commit(next);
      return next;
    },
    [store, commit],
  );

  return {
    store,
    at,
    playing,
    stopToken,
    seek,
    nudge: (delta) =>
      seek(movePlayhead(store.get(), delta, latest.current.duration)),
    jump: (direction) => {
      const target = neighbourTarget(
        latest.current.targets,
        store.get(),
        direction,
      );
      return target === null ? null : seek(target);
    },
    onTime: (t) => {
      if (!handOver.current) store.set(t);
    },
    onPlayingChange: (value) => {
      playingRef.current = value;
      if (!value) handOver.current = false;
      setPlaying(value);
      // La lecture s'arrête : l'aperçu immobile montre l'endroit où elle s'est arrêtée.
      if (!value) setAt(store.get());
    },
  };
}
