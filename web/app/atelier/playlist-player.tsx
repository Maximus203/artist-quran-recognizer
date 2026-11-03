"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { ECHO } from "@/lib/audio-echo";
import { formatClockLength } from "@/lib/format";
import type { Interval } from "@/lib/recognition";
import {
  createQueue,
  currentId,
  jumpTo,
  nextRepeat,
  onEnded,
  skipNext,
  skipPrev,
  withRepeat,
  withShuffle,
  type Queue,
  type RepeatMode,
} from "@/lib/playlist-queue";
import { applyEcho } from "./echo-graph";
import { Icon } from "./icons";
import { PlaylistVerse } from "./playlist-verse";
import { useShell } from "./shell";

type Item = {
  session_id: string;
  name: string;
  state: string;
  audio_duration_s: number | null;
};
type Detail = { id: number; name: string; items: Item[] };

const REPEAT_LABEL: Record<RepeatMode, string> = {
  off: "Répétition : désactivée",
  all: "Répétition : toute la playlist",
  one: "Répétition : cet audio",
};

const audioUrl = (id: string) => `/api/sessions/${id}/audio`;

/**
 * Le lecteur d'une playlist : un seul `<audio>`, piloté par la file de lecture (`lib/playlist-queue.ts`, testée) :
 * passage automatique à l'audio suivant, répétition (aucune, toute la playlist, un audio), lecture aléatoire,
 * précédent / suivant. Volume, vitesse et écho sont ceux du compte. L'ordre se change ici et se garde.
 */
export function PlaylistPlayer({ playlistId }: { playlistId: number }) {
  const { prefs, update } = useShell();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    "loading",
  );
  const [queue, setQueue] = useState<Queue>(() => createQueue([]));
  const queueRef = useRef(queue);
  queueRef.current = queue;
  /** Vrai tant que la lecture est voulue : le passage à l'audio suivant continue de lire. */
  const wantPlay = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [notice, setNotice] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Les versets de l'audio en cours, pour afficher leur traduction en haut du lecteur. */
  const [verses, setVerses] = useState<{
    id: string;
    status: "loading" | "ready" | "error";
    intervals: Interval[];
  }>({ id: "", status: "loading", intervals: [] });

  /* ── chargement ── */
  const apply = useCallback((next: Detail, keepId?: string | null) => {
    setDetail(next);
    const ids = next.items.map((item) => item.session_id);
    setQueue((prev) =>
      createQueue(ids, {
        startId: keepId ?? currentId(prev) ?? undefined,
        repeat: prev.repeat,
        shuffle: prev.shuffle,
      }),
    );
  }, []);
  useEffect(() => {
    let cancelled = false;
    api<{ playlist: Detail }>(`/api/playlists/${playlistId}`)
      .then((data) => {
        if (cancelled) return;
        apply(data.playlist);
        setState("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        setState(
          error instanceof ApiError && error.status === 404
            ? "missing"
            : "error",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [playlistId, apply]);

  /* ── l'audio courant ── */
  const current = currentId(queue);
  const currentItem = detail?.items.find((item) => item.session_id === current);
  const play = useCallback(() => {
    const node = audioRef.current;
    if (!node) return;
    node.play().catch(() => {
      wantPlay.current = false;
      setNotice("Lecture impossible pour cet audio dans ce navigateur.");
    });
  }, []);
  useEffect(() => {
    const node = audioRef.current;
    if (!node || !current) return;
    node.src = audioUrl(current);
    node.load();
    setTime(0);
    setDuration(0);
    if (wantPlay.current) play();
  }, [current, play]);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setVerses({ id: current, status: "loading", intervals: [] });
    api<{ result: { intervals?: Interval[] } | null }>(
      `/api/sessions/${current}`,
    )
      .then((data) => {
        if (cancelled) return;
        setVerses({
          id: current,
          status: "ready",
          intervals: data.result?.intervals ?? [],
        });
      })
      .catch(() => {
        if (!cancelled)
          setVerses({ id: current, status: "error", intervals: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [current]);

  /* ── volume, vitesse et écho du compte ── */
  useEffect(() => {
    const node = audioRef.current;
    if (!node) return;
    const sync = () => {
      node.volume = prefs.volume;
      node.playbackRate = prefs.playbackRate;
    };
    sync();
    // `load()` remet la vitesse à zéro : on la réapplique à chaque nouvel audio.
    node.addEventListener("loadstart", sync);
    return () => node.removeEventListener("loadstart", sync);
  }, [prefs.volume, prefs.playbackRate, state]);
  useEffect(() => {
    if (audioRef.current) applyEcho(audioRef.current, prefs.echo);
  }, [prefs.echo, state]);

  /* ── événements de l'élément audio ── */
  const restartOrAdvance = useCallback((next: Queue) => {
    const same = currentId(next) === currentId(queueRef.current);
    setQueue(next);
    if (same && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => undefined);
    }
  }, []);
  useEffect(() => {
    const node = audioRef.current;
    if (!node) return;
    const onTime = () => setTime(node.currentTime);
    const onMeta = () =>
      setDuration(Number.isFinite(node.duration) ? node.duration : 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnd = () => {
      const result = onEnded(queueRef.current);
      if (!result.play) {
        wantPlay.current = false;
        setPlaying(false);
        return;
      }
      wantPlay.current = true;
      restartOrAdvance(result.queue);
    };
    const onFail = () => {
      if (!node.getAttribute("src")) return;
      const name = detail?.items.find(
        (i) => i.session_id === currentId(queueRef.current),
      )?.name;
      setNotice(
        `Audio illisible${name ? ` : « ${name} »` : ""}. Passage au suivant.`,
      );
      const result = skipNext(queueRef.current);
      if (result.action === "move") restartOrAdvance(result.queue);
      else wantPlay.current = false;
    };
    node.addEventListener("timeupdate", onTime);
    node.addEventListener("loadedmetadata", onMeta);
    node.addEventListener("durationchange", onMeta);
    node.addEventListener("play", onPlay);
    node.addEventListener("pause", onPause);
    node.addEventListener("ended", onEnd);
    node.addEventListener("error", onFail);
    return () => {
      node.removeEventListener("timeupdate", onTime);
      node.removeEventListener("loadedmetadata", onMeta);
      node.removeEventListener("durationchange", onMeta);
      node.removeEventListener("play", onPlay);
      node.removeEventListener("pause", onPause);
      node.removeEventListener("ended", onEnd);
      node.removeEventListener("error", onFail);
    };
  }, [state, detail, restartOrAdvance]);

  /* ── commandes ── */
  const toggle = () => {
    const node = audioRef.current;
    if (!node || !current) return;
    setNotice("");
    if (node.paused) {
      wantPlay.current = true;
      play();
    } else {
      wantPlay.current = false;
      node.pause();
    }
  };
  const next = () => {
    const result = skipNext(queue);
    if (result.action === "move") {
      wantPlay.current = playing;
      restartOrAdvance(result.queue);
    }
  };
  const previous = () => {
    const node = audioRef.current;
    const result = skipPrev(queue, node?.currentTime ?? 0);
    if (result.action === "restart" && node) node.currentTime = 0;
    else if (result.action === "move") {
      wantPlay.current = playing;
      restartOrAdvance(result.queue);
    }
  };
  const open = (id: string) => {
    wantPlay.current = true;
    setNotice("");
    restartOrAdvance(jumpTo(queue, id));
  };
  const seek = (value: number) => {
    if (audioRef.current) audioRef.current.currentTime = value;
    setTime(value);
  };

  /* ── contenu : ordre, retrait, nom ── */
  const fail = (error: unknown) =>
    setNotice(error instanceof Error ? error.message : "Action impossible.");
  const move = async (index: number, delta: -1 | 1) => {
    if (!detail) return;
    const ids = detail.items.map((item) => item.session_id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      const data = await api<{ playlist: Detail }>(
        `/api/playlists/${detail.id}`,
        {
          method: "PATCH",
          json: { order: ids },
        },
      );
      apply(data.playlist);
    } catch (error) {
      fail(error);
    }
  };
  const remove = async (id: string) => {
    if (!detail) return;
    try {
      await api(`/api/playlists/${detail.id}/items/${id}`, {
        method: "DELETE",
      });
      const items = detail.items.filter((item) => item.session_id !== id);
      const ids = items.map((item) => item.session_id);
      const at = detail.items.findIndex((item) => item.session_id === id);
      apply(
        { ...detail, items },
        id === current ? (ids[at] ?? ids[0] ?? null) : current,
      );
    } catch (error) {
      fail(error);
    }
  };
  const rename = async () => {
    if (!detail || renaming === null) return;
    const name = renaming.trim();
    setRenaming(null);
    if (!name || name === detail.name) return;
    try {
      const data = await api<{ playlist: Detail }>(
        `/api/playlists/${detail.id}`,
        {
          method: "PATCH",
          json: { name },
        },
      );
      setDetail((d) => (d ? { ...d, name: data.playlist.name } : d));
    } catch (error) {
      fail(error);
    }
  };

  /* ── affichage ── */
  if (state === "loading")
    return (
      <div className="page pl" data-testid="playlist-loading">
        <p className="mini" role="status">
          Chargement…
        </p>
      </div>
    );
  if (state !== "ready" || !detail)
    return (
      <div className="page pl" data-testid="playlist-error">
        <p className="notice notice--error" role="alert">
          {state === "missing"
            ? "Cette playlist n’existe pas, ou elle n’est pas à toi."
            : "La playlist n’a pas pu être chargée."}
        </p>
        <Link href="/playlists">Retour aux playlists</Link>
      </div>
    );

  const total = detail.items.reduce(
    (sum, i) => sum + (i.audio_duration_s ?? 0),
    0,
  );
  return (
    <div className="page pl" data-testid="playlist-player">
      <nav className="ex-crumb" aria-label="Fil d’Ariane">
        <Link href="/playlists">
          <Icon name="arrow-l" />
          Mes playlists
        </Link>
      </nav>
      <header className="pl-head">
        {renaming === null ? (
          <h1 data-testid="pl-title">
            {detail.name}{" "}
            <button
              type="button"
              className="btn btn--ghost btn--icon btn--sm"
              aria-label="Renommer la playlist"
              onClick={() => setRenaming(detail.name)}
            >
              <Icon name="edit" />
            </button>
          </h1>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <input
              className="input"
              autoFocus
              value={renaming}
              maxLength={60}
              aria-label="Nom de la playlist"
              data-testid="pl-rename"
              onChange={(event) => setRenaming(event.target.value)}
              onBlur={() => void rename()}
            />
          </form>
        )}
        <p className="mini">
          {detail.items.length} audio{detail.items.length > 1 ? "s" : ""} ·{" "}
          {formatClockLength(total)}
        </p>
      </header>

      <div className="pl-body">
        {detail.items.length === 0 ? (
          <p className="notice" data-testid="pl-empty">
            Cette playlist est vide. Ajoute des audios depuis la{" "}
            <Link href="/sessions">liste des sessions</Link> : menu d’une ligne,
            « Ajouter à une playlist ».
          </p>
        ) : (
          <section className="pl-card" aria-label="Lecteur">
            <audio ref={audioRef} preload="metadata" />
            <PlaylistVerse
              status={verses.id === current ? verses.status : "loading"}
              intervals={verses.id === current ? verses.intervals : []}
              time={time}
              playing={playing}
              offsetMs={prefs.audioOffsetMs}
            />
            <p className="pl-now" data-testid="pl-now" aria-live="polite">
              <span className="eyebrow">En lecture</span>
              <b>{currentItem?.name ?? "—"}</b>
            </p>
            <div className="pl-seek">
              <span className="mono">{formatClockLength(time)}</span>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(time, duration || 0)}
                aria-label="Position dans l’audio"
                data-testid="pl-seek"
                disabled={!duration}
                style={
                  {
                    "--p": `${duration ? (time / duration) * 100 : 0}%`,
                  } as React.CSSProperties
                }
                onChange={(event) => seek(Number(event.target.value))}
              />
              <span className="mono">{formatClockLength(duration)}</span>
            </div>
            <div className="pl-transport">
              <button
                type="button"
                className="pl-btn"
                aria-label="Lecture aléatoire"
                aria-pressed={queue.shuffle}
                data-testid="pl-shuffle"
                onClick={() => setQueue(withShuffle(queue, !queue.shuffle))}
              >
                <Icon name="shuffle" />
              </button>
              <button
                type="button"
                className="pl-btn"
                aria-label="Audio précédent"
                data-testid="pl-prev"
                onClick={previous}
              >
                <Icon name="skip-prev" />
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--main"
                aria-label={playing ? "Mettre en pause" : "Lire"}
                data-testid="pl-play"
                onClick={toggle}
              >
                <Icon name={playing ? "pause" : "play"} />
              </button>
              <button
                type="button"
                className="pl-btn"
                aria-label="Audio suivant"
                data-testid="pl-next"
                onClick={next}
              >
                <Icon name="skip-next" />
              </button>
              <button
                type="button"
                className="pl-btn"
                aria-label={REPEAT_LABEL[queue.repeat]}
                aria-pressed={queue.repeat !== "off"}
                data-testid="pl-repeat"
                data-mode={queue.repeat}
                title={REPEAT_LABEL[queue.repeat]}
                onClick={() =>
                  setQueue(withRepeat(queue, nextRepeat(queue.repeat)))
                }
              >
                <Icon name={queue.repeat === "one" ? "repeat-one" : "repeat"} />
              </button>
            </div>
            <div className="pl-mix">
              <label>
                Volume
                <input
                  className="vol"
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={prefs.volume}
                  aria-label="Volume"
                  style={
                    { "--p": `${prefs.volume * 100}%` } as React.CSSProperties
                  }
                  onChange={(event) =>
                    update({ volume: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Écho
                <input
                  className="vol"
                  type="range"
                  min={ECHO.min}
                  max={ECHO.max}
                  step={ECHO.step}
                  value={prefs.echo}
                  aria-label="Écho de l’écoute"
                  data-testid="pl-echo"
                  style={
                    { "--p": `${prefs.echo * 100}%` } as React.CSSProperties
                  }
                  onChange={(event) =>
                    update({ echo: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            {notice ? (
              <p
                className="notice notice--error"
                role="status"
                data-testid="pl-notice"
              >
                {notice}
              </p>
            ) : null}
          </section>
        )}

        {detail.items.length > 0 ? (
          <ol className="pl-list" aria-label="Audios de la playlist">
            {detail.items.map((item, index) => (
              <li
                key={item.session_id}
                className="pl-item"
                aria-current={item.session_id === current ? "true" : undefined}
                data-testid={`pl-item-${item.session_id}`}
              >
                <button
                  type="button"
                  className="pl-open"
                  onClick={() => open(item.session_id)}
                  data-testid={`pl-open-${item.session_id}`}
                >
                  <span className="pl-n mono">{index + 1}</span>
                  <span className="pl-name">{item.name}</span>
                  <span className="pl-dur mono">
                    {item.audio_duration_s
                      ? formatClockLength(item.audio_duration_s)
                      : ""}
                  </span>
                </button>
                <span className="pl-actions">
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label={`Monter « ${item.name} »`}
                    disabled={index === 0}
                    onClick={() => void move(index, -1)}
                  >
                    <Icon name="chevron-d" className="i-flip" />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label={`Descendre « ${item.name} »`}
                    disabled={index === detail.items.length - 1}
                    onClick={() => void move(index, 1)}
                  >
                    <Icon name="chevron-d" />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--sm"
                    aria-label={`Retirer « ${item.name} » de la playlist`}
                    data-testid={`pl-remove-${item.session_id}`}
                    onClick={() => void remove(item.session_id)}
                  >
                    <Icon name="x" />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        ) : null}
      </div>
    </div>
  );
}
