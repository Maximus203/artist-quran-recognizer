"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { formatClockLength } from "@/lib/format";
import type { Preferences } from "@/lib/preferences-schema";
import {
  createQueue,
  currentId,
  jumpTo,
  nextRepeat,
  skipNext,
  skipPrev,
  withRepeat,
  withShuffle,
  type RepeatMode,
} from "@/lib/playlist-queue";
import { ArabicFontTools } from "./arabic-font-tools";
import { Console } from "./console";
import { useGlobalPlayer } from "./global-player";
import { useStoreValue } from "./hooks";
import { Icon } from "./icons";
import { LivePassage } from "./passage-card";
import { useShell } from "./shell";
import type { TimelineHandle } from "./timeline";
import { usePeaks } from "./use-peaks";
import { useFreeSpeech } from "./use-free-speech";
import { useSessionDetail } from "./use-sessions";

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

/**
 * Le lecteur d'une playlist : les mêmes blocs que la page Lecture (passage actif avec surlignage mot à mot,
 * écoute de la source avec l'onde et le retour en arrière), pilotés par la file de lecture
 * (`lib/playlist-queue.ts`, testée) : suivant, précédent, répétition, aléatoire. L'audio vit dans le lecteur
 * global de la coque : la lecture, et la suite de la playlist, continuent quand on change de page.
 */
export function PlaylistPlayer({ playlistId }: { playlistId: number }) {
  const { prefs, update } = useShell();
  const {
    player,
    audioId,
    playlist,
    hooks,
    activatePlaylist,
    syncPlaylist,
    isActive,
    isPlaying,
    setQueue,
    requestPlay,
    registerFullUi,
    rememberLabel,
  } = useGlobalPlayer();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">(
    "loading",
  );
  const [notice, setNotice] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Audio à garder comme courant au prochain rechargement de la liste (retrait d'un audio). */
  const keepRef = useRef<string | null>(null);
  const timelineRef = useRef<TimelineHandle>(null);
  const [follow, setFollow] = useState(prefs.followPlayback);

  const apply = useCallback((next: Detail, keepId?: string | null) => {
    keepRef.current = keepId ?? null;
    setDetail(next);
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

  /* ── la file : celle du lecteur global si cette playlist est en cours, sinon un aperçu ── */
  const active = playlist?.id === playlistId;
  const ids = useMemo(
    () => detail?.items.map((item) => item.session_id) ?? [],
    [detail],
  );
  const preview = useMemo(() => createQueue(ids), [ids]);
  const queue = active && playlist ? playlist.queue : preview;
  const current = currentId(queue);
  const currentItem = detail?.items.find((item) => item.session_id === current);
  const playing = useStoreValue(player.store, (s) => s.playing) && active;
  const elsewhere = !active && audioId !== null && isPlaying();

  useEffect(() => {
    if (!detail) return;
    for (const item of detail.items) rememberLabel(item.session_id, item.name);
    if (isActive(playlistId)) syncPlaylist(playlistId, ids, keepRef.current);
    // Rien ne joue ailleurs : la playlist se charge (sans lancer la lecture) pour montrer son premier audio.
    else if (!isPlaying()) activatePlaylist(playlistId, ids);
    keepRef.current = null;
  }, [
    detail,
    ids,
    playlistId,
    isActive,
    isPlaying,
    syncPlaylist,
    activatePlaylist,
    rememberLabel,
  ]);
  useEffect(() => {
    hooks.current = { onError: setNotice };
    return () => {
      hooks.current = {};
    };
  }, [hooks]);
  // Les commandes sont ici tant que cette playlist est en lecture : le mini lecteur s'efface.
  useEffect(() => {
    if (!active) return;
    return registerFullUi();
  }, [active, registerFullUi]);

  /* ── l'audio courant : résultat, onde, passage actif ── */
  const { detail: session, reload: reloadSession } = useSessionDetail(
    active ? audioId : null,
  );
  const intervals = useMemo(
    () =>
      session && session.session.id === audioId
        ? (session.result?.intervals ?? [])
        : [],
    [session, audioId],
  );
  const spoken = useFreeSpeech(
    active ? audioId : null,
    session?.free_speech,
    reloadSession,
  );
  const { peaks, listening } = usePeaks(active ? audioId : null, setNotice);
  const playerDuration = useStoreValue(player.store, (s) => s.duration);
  const duration =
    playerDuration ||
    peaks?.duration ||
    session?.result?.source.duration_s ||
    0;
  const selectInterval = useCallback(
    (index: number) => {
      const item = intervals[index];
      if (!item?.t) return;
      setFollow(false);
      player.seek(item.t[0]);
      timelineRef.current?.centerOn(item.t[0]);
    },
    [intervals, player],
  );
  const listenPassage = ([start, end]: [number, number]) => {
    timelineRef.current?.centerOn(start);
    player.playRange(start, end);
  };
  const loopPassage = useCallback(
    ([start, end]: [number, number]) => {
      timelineRef.current?.centerOn(start);
      player.playRange(start, end, { loop: true });
    },
    [player],
  );

  /* ── commandes ── */
  const start = (startId?: string) =>
    activatePlaylist(playlistId, ids, { startId, play: true });
  const toggle = () => {
    setNotice("");
    if (!active) start(current ?? undefined);
    else player.toggle();
  };
  const next = () => {
    const result = skipNext(queue);
    if (result.action === "move")
      setQueue(result.queue, { restartIfSame: true });
  };
  const previous = () => {
    const result = skipPrev(queue, player.position());
    if (result.action === "restart") player.seek(0);
    else if (result.action === "move")
      setQueue(result.queue, { restartIfSame: true });
  };
  const open = (id: string) => {
    setNotice("");
    if (!active) return start(id);
    setQueue(jumpTo(queue, id), { restartIfSame: true });
    requestPlay();
  };

  /* ── contenu : ordre, retrait, nom ── */
  const fail = (error: unknown) =>
    setNotice(error instanceof Error ? error.message : "Action impossible.");
  const move = async (index: number, delta: -1 | 1) => {
    if (!detail) return;
    const order = [...ids];
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    [order[index], order[target]] = [order[target], order[index]];
    try {
      const data = await api<{ playlist: Detail }>(
        `/api/playlists/${detail.id}`,
        { method: "PATCH", json: { order } },
      );
      apply(data.playlist, current);
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
      const rest = items.map((item) => item.session_id);
      const at = detail.items.findIndex((item) => item.session_id === id);
      apply(
        { ...detail, items },
        id === current ? (rest[at] ?? rest[0] ?? null) : current,
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
        { method: "PATCH", json: { name } },
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

      {detail.items.length === 0 ? (
        <p className="notice" data-testid="pl-empty">
          Cette playlist est vide. Ajoute des audios depuis la{" "}
          <Link href="/sessions">liste des récitations</Link> : menu d’une
          ligne, « Ajouter à une playlist ».
        </p>
      ) : (
        <div className="pl-body">
          <div className="pl-main">
            <section className="pl-card" aria-label="Playlist en lecture">
              <p className="pl-now" data-testid="pl-now" aria-live="polite">
                <span className="eyebrow">En lecture</span>
                <b>{currentItem?.name ?? "—"}</b>
              </p>
              <div className="pl-transport">
                <button
                  type="button"
                  className="pl-btn"
                  aria-label="Lecture aléatoire"
                  aria-pressed={queue.shuffle}
                  data-testid="pl-shuffle"
                  disabled={!active}
                  onClick={() => setQueue(withShuffle(queue, !queue.shuffle))}
                >
                  <Icon name="shuffle" />
                </button>
                <button
                  type="button"
                  className="pl-btn"
                  aria-label="Audio précédent"
                  data-testid="pl-prev"
                  disabled={!active}
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
                  disabled={!active}
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
                  disabled={!active}
                  onClick={() =>
                    setQueue(withRepeat(queue, nextRepeat(queue.repeat)))
                  }
                >
                  <Icon
                    name={queue.repeat === "one" ? "repeat-one" : "repeat"}
                  />
                </button>
              </div>
              {elsewhere ? (
                <p className="notice" data-testid="pl-elsewhere">
                  Un autre audio est en cours de lecture. Lance un audio de
                  cette playlist pour le remplacer.
                </p>
              ) : null}
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

            {active && audioId ? (
              session && session.session.id === audioId ? (
                <>
                  <LivePassage
                    store={player.store}
                    intervals={intervals}
                    selectedIndex={null}
                    sessionId={audioId}
                    showTranslation={prefs.translation}
                    onToggleTranslation={() =>
                      update({ translation: !prefs.translation })
                    }
                    liveHighlight={prefs.liveHighlight}
                    onToggleLive={() =>
                      update({ liveHighlight: !prefs.liveHighlight })
                    }
                    audioOffsetMs={prefs.audioOffsetMs}
                    onAudioOffset={(audioOffsetMs) => update({ audioOffsetMs })}
                    onSeek={player.seek}
                    onLoop={loopPassage}
                    onStopLoop={player.stopPlayback}
                    tools={<ArabicFontTools intervals={intervals} />}
                    onListen={listenPassage}
                    freeSpeech={spoken.items}
                    onSpokenReview={spoken.review}
                  />
                  <Console
                    player={player}
                    duration={duration}
                    peaks={peaks}
                    listening={listening}
                    intervals={intervals}
                    selectedIndex={null}
                    onSelectInterval={selectInterval}
                    timelineRef={timelineRef}
                    span={prefs.visibleSpanSeconds}
                    onSpan={(span) =>
                      update({
                        visibleSpanSeconds:
                          span as Preferences["visibleSpanSeconds"],
                      })
                    }
                    follow={follow}
                    onFollow={setFollow}
                    onFollowToggle={(on) => {
                      setFollow(on);
                      update({ followPlayback: on });
                    }}
                    annotate={false}
                    onSelectAnnotation={() => undefined}
                  />
                </>
              ) : (
                <p
                  className="mini"
                  role="status"
                  data-testid="pl-loading-audio"
                >
                  Chargement de la récitation…
                </p>
              )
            ) : null}
          </div>

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
        </div>
      )}
    </div>
  );
}
