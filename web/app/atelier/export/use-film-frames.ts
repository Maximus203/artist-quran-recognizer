"use client";
import { useEffect, useState } from "react";
import { captureFilmFrames } from "@/lib/background-video-probe";

/**
 * Les vignettes de la bande « film » d'une vidéo de fond. Une seule lecture par fichier, quel que soit le nombre
 * d'écrans qui les montrent (la section « Vidéo de fond » ET la chronologie de la table de montage) : la vidéo est
 * décodée une fois, chaque écran se remplit au fur et à mesure, et la lecture s'arrête quand plus personne ne
 * regarde ce fichier.
 */
export const FILM_FRAME_COUNT = 12;

type Capture = typeof captureFilmFrames;
type Entry = {
  frames: Array<string | null>;
  listeners: Set<() => void>;
  users: number;
  stop: AbortController;
};

const entries = new WeakMap<Blob, Entry>();

function open(file: Blob, capture: Capture, count: number): Entry {
  const known = entries.get(file);
  if (known) return known;
  const entry: Entry = {
    frames: Array.from({ length: count }, () => null),
    listeners: new Set(),
    users: 0,
    stop: new AbortController(),
  };
  entries.set(file, entry);
  void capture(file, count, {
    signal: entry.stop.signal,
    onFrame: (index, url) => {
      if (entry.stop.signal.aborted) return;
      entry.frames = entry.frames.map((frame, i) =>
        i === index ? url : frame,
      );
      for (const listener of [...entry.listeners]) listener();
    },
  }).catch(() => undefined);
  return entry;
}

/** Les vignettes de `file` (cases vides tant qu'elles ne sont pas prêtes) ; `[]` sans fichier. */
export function useFilmFrames(
  file: Blob | null,
  capture: Capture = captureFilmFrames,
  count: number = FILM_FRAME_COUNT,
): Array<string | null> {
  const [frames, setFrames] = useState<Array<string | null>>([]);
  useEffect(() => {
    if (!file) {
      setFrames([]);
      return;
    }
    const entry = open(file, capture, count);
    entry.users += 1;
    const update = () => setFrames(entry.frames);
    entry.listeners.add(update);
    update();
    return () => {
      entry.listeners.delete(update);
      entry.users -= 1;
      if (entry.users === 0) {
        entry.stop.abort();
        if (entries.get(file) === entry) entries.delete(file);
      }
    };
    // Le service de lecture ne change pas en cours de route : seul le fichier relance la capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  return frames;
}
