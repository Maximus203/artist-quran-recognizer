"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createStore } from "@/lib/mini-store";

export type PlayerState = { time: number; duration: number; playing: boolean };

/** Arrêt d'un passage écouté : 10 ms avant sa fin, pour que la carte l'affiche encore. */
export const STOP_MARGIN_S = 0.01;
const PLAY_ERROR = "Lecture impossible pour cet audio dans ce navigateur.";

export type RangeOptions = {
  loop?: boolean;
  /** Appelé quand la plage a été écoutée jusqu'au bout (fin, ou un tour de boucle). */
  onDone?: () => void;
};

/**
 * Le lecteur : un `<audio>` (la copie d'écoute exacte), la position publiée dans un magasin (elle
 * change à chaque image : seuls les composants qui la lisent se redessinent), l'écoute d'une plage
 * précise (« Écouter ce passage », écoute d'un signalement, boucle).
 */
export function usePlayer(
  sessionId: string | null,
  handlers: { onError: (message: string) => void; onPlay: () => void },
) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // L'élément <audio> n'existe qu'une fois la session chargée : les écouteurs s'attachent quand il
  // apparaît (ref callback + état), pas au premier rendu où il est encore absent.
  const [node, setNode] = useState<HTMLAudioElement | null>(null);
  const attach = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
    setNode(element);
  }, []);
  const store = useMemo(
    () => createStore<PlayerState>({ time: 0, duration: 0, playing: false }),
    [],
  );
  const stopAt = useRef<number | null>(null);
  const loop = useRef<[number, number] | null>(null);
  const done = useRef<(() => void) | null>(null);
  const raf = useRef(0);
  const events = useRef(handlers);
  events.current = handlers;
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    store.set({ time: 0, duration: 0, playing: false });
    stopAt.current = null;
    loop.current = null;
    done.current = null;
  }, [sessionId, store]);

  useEffect(() => {
    if (!node) return;
    node.volume = volume;
    node.playbackRate = rate;
  }, [node, volume, rate]);

  useEffect(() => {
    if (!node) return;
    const finish = () => {
      const callback = done.current;
      if (!loop.current) done.current = null;
      callback?.();
    };
    /** Fin d'une plage écoutée : arrêt (ou retour au début en boucle). */
    const check = () => {
      const end = stopAt.current;
      if (end !== null && node.currentTime >= end - STOP_MARGIN_S) {
        stopAt.current = null;
        node.pause();
        node.currentTime = end - STOP_MARGIN_S;
        finish();
        return;
      }
      const range = loop.current;
      if (
        range &&
        (node.currentTime >= range[1] || node.currentTime < range[0])
      ) {
        const wrapped = node.currentTime >= range[1];
        node.currentTime = range[0];
        if (wrapped) finish();
      }
    };
    const publish = () =>
      store.set((state) => ({ ...state, time: node.currentTime }));
    const tick = () => {
      check();
      publish();
      if (!node.paused) raf.current = requestAnimationFrame(tick);
    };
    // requestAnimationFrame est suspendu quand l'onglet est masqué : timeupdate prend le relais.
    const onTimeUpdate = () => {
      check();
      if (document.hidden) publish();
    };
    const onPlay = () => {
      events.current.onPlay();
      store.set((state) => ({ ...state, playing: true }));
      tick();
    };
    const onPause = () => {
      stopAt.current = null;
      cancelAnimationFrame(raf.current);
      store.set((state) => ({
        ...state,
        playing: false,
        time: node.currentTime,
      }));
    };
    const onSeek = () => publish();
    const onDuration = () =>
      store.set((state) => ({
        ...state,
        duration: Number.isFinite(node.duration) ? node.duration : 0,
      }));
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
  }, [node, store]);

  const play = useCallback(() => {
    const node = audioRef.current;
    if (!node) return Promise.resolve();
    return node.play().catch(() => events.current.onError(PLAY_ERROR));
  }, []);

  const stopRange = useCallback(() => {
    stopAt.current = null;
    loop.current = null;
    done.current = null;
  }, []);

  const seek = useCallback(
    (time: number) => {
      const node = audioRef.current;
      if (!node) return;
      stopAt.current = null;
      node.currentTime = Math.max(0, time);
      store.set((state) => ({ ...state, time: node.currentTime }));
    },
    [store],
  );

  const skip = useCallback(
    (delta: number) => {
      const node = audioRef.current;
      if (!node) return;
      const top = store.get().duration || node.duration || Infinity;
      seek(Math.min(top, Math.max(0, node.currentTime + delta)));
    },
    [seek, store],
  );

  const toggle = useCallback(() => {
    const node = audioRef.current;
    if (!node) return;
    if (node.paused) {
      stopRange();
      void play();
    } else node.pause();
  }, [play, stopRange]);

  /** Joue exactement [début, fin] puis s'arrête ; en boucle, repart du début à chaque tour. */
  const playRange = useCallback(
    (start: number, end: number, options: RangeOptions = {}) => {
      const node = audioRef.current;
      if (!node) return;
      stopRange();
      done.current = options.onDone ?? null;
      node.currentTime = start;
      store.set((state) => ({ ...state, time: start }));
      if (options.loop) loop.current = [start, end];
      void node.play().then(
        () => {
          if (!options.loop) stopAt.current = end;
        },
        () => events.current.onError(PLAY_ERROR),
      );
    },
    [stopRange, store],
  );

  const position = useCallback(
    () => audioRef.current?.currentTime ?? store.get().time,
    [store],
  );

  return {
    attach,
    store,
    rate,
    setRate,
    volume,
    setVolume,
    toggle,
    seek,
    skip,
    playRange,
    stopRange,
    position,
  };
}
