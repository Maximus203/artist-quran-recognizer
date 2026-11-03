"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import {
  createQueue,
  currentId,
  onEnded as queueEnded,
  skipNext,
  type Queue,
} from "@/lib/playlist-queue";
import { MiniPlayer } from "./mini-player";
import { useShell } from "./shell";
import { usePlayer } from "./use-player";

/** Ce qu'une page branche sur le lecteur le temps qu'elle est affichée. */
type Hooks = {
  /** La lecture démarre (la lecture désélectionne le passage choisi). */
  onPlay?: () => void;
  onError?: (message: string) => void;
};

export type ActivePlaylist = { id: number; queue: Queue };

type PlayerContext = {
  player: ReturnType<typeof usePlayer>;
  /** L'audio chargé (récitation seule, ou celui de la playlist en cours), sinon rien. */
  audioId: string | null;
  playlist: ActivePlaylist | null;
  hooks: MutableRefObject<Hooks>;
  /** Charge une récitation seule : sort de la playlist, ne lance pas la lecture. Même audio : rien ne bouge. */
  loadSingle: (id: string) => void;
  /** Charge une playlist (garde répétition et aléatoire) ; `play` lance la lecture. */
  activatePlaylist: (
    id: number,
    ids: readonly string[],
    options?: { startId?: string; play?: boolean },
  ) => void;
  /** La playlist change de contenu ou d'ordre : la file suit sans changer d'audio (sauf `keepId`). */
  syncPlaylist: (
    id: number,
    ids: readonly string[],
    keepId?: string | null,
  ) => void;
  isActive: (id: number) => boolean;
  isPlaying: () => boolean;
  /**
   * Remplace la file de la playlist en cours (suivant, précédent, aléatoire, répétition).
   * `restartIfSame` : « suivant » retombe sur le même audio (une seule piste en boucle) : on le relance.
   */
  setQueue: (queue: Queue, options?: { restartIfSame?: boolean }) => void;
  /** Lance la lecture de l'audio courant (une fois chargé). */
  requestPlay: () => void;
  /** Une page qui montre déjà toutes les commandes se déclare : le mini lecteur se retire. */
  registerFullUi: () => () => void;
  /** Nom d'un audio, pour le mini lecteur. */
  rememberLabel: (id: string, name: string) => void;
};

const Context = createContext<PlayerContext | null>(null);

export function useGlobalPlayer(): PlayerContext {
  const value = useContext(Context);
  if (!value)
    throw new Error("useGlobalPlayer : hors du fournisseur de lecteur");
  return value;
}

/**
 * Le lecteur de l'atelier : un seul `<audio>`, rangé dans la coque des pages connectées. Il reste monté
 * quand on passe d'une page à l'autre, donc la lecture continue (comme un vrai lecteur de sons), y compris
 * la suite d'une playlist. La page « Lecture » et la page d'une playlist affichent ses commandes ; ailleurs,
 * un mini lecteur permet de mettre en pause ou d'arrêter.
 */
export function GlobalPlayerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { prefs, update } = useShell();
  const [single, setSingle] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<ActivePlaylist | null>(null);
  const [nonce, setNonce] = useState(0);
  const [fullUi, setFullUi] = useState(0);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const audioId = playlist ? currentId(playlist.queue) : single;

  const hooks = useRef<Hooks>({});
  const wantPlay = useRef(false);
  const nodeRef = useRef<HTMLAudioElement | null>(null);
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;
  const audioIdRef = useRef(audioId);
  audioIdRef.current = audioId;

  const player = usePlayer(audioId, {
    onError: (message) => hooks.current.onError?.(message),
    onPlay: () => hooks.current.onPlay?.(),
    rate: prefs.playbackRate,
    volume: prefs.volume,
    onRate: (playbackRate) => update({ playbackRate }),
    onVolume: (volume) => update({ volume }),
    echo: prefs.echo,
    onEcho: (echo) => update({ echo }),
  });
  const { attach } = player;
  const store = player.store;

  const attachNode = useCallback(
    (element: HTMLAudioElement | null) => {
      nodeRef.current = element;
      attach(element);
    },
    [attach],
  );

  // Un nouvel audio est chargé (suite de la playlist, ou « Lire » demandé) : la lecture repart si elle est voulue.
  useEffect(() => {
    if (!audioId || !wantPlay.current) return;
    nodeRef.current?.play().catch(() => {
      wantPlay.current = false;
      hooks.current.onError?.(
        "Lecture impossible pour cet audio dans ce navigateur.",
      );
    });
  }, [audioId, nonce]);

  const restartCurrent = useCallback(() => {
    const node = nodeRef.current;
    if (!node) return;
    node.currentTime = 0;
    void node.play().catch(() => undefined);
  }, []);

  const loadSingle = useCallback((id: string) => {
    if (audioIdRef.current === id) return;
    wantPlay.current = false;
    setPlaylist(null);
    setSingle(id);
  }, []);

  const activatePlaylist = useCallback<PlayerContext["activatePlaylist"]>(
    (id, ids, options = {}) => {
      wantPlay.current = Boolean(options.play);
      setPlaylist((prev) => {
        const queue = createQueue(ids, {
          startId: options.startId,
          repeat: prev?.queue.repeat,
          shuffle: prev?.queue.shuffle,
        });
        return queue.natural.length === 0 ? null : { id, queue };
      });
      if (options.play) setNonce((n) => n + 1);
    },
    [],
  );

  const syncPlaylist = useCallback<PlayerContext["syncPlaylist"]>(
    (id, ids, keepId) => {
      setPlaylist((prev) => {
        if (!prev || prev.id !== id) return prev;
        if (ids.length === 0) return null;
        const same =
          prev.queue.natural.length === ids.length &&
          prev.queue.natural.every((value, i) => value === ids[i]);
        // Rien n'a changé : on garde le même objet (sinon la page qui synchronise reboucle).
        if (same && (!keepId || keepId === currentId(prev.queue))) return prev;
        return {
          id,
          queue: createQueue(ids, {
            startId: keepId ?? currentId(prev.queue) ?? undefined,
            repeat: prev.queue.repeat,
            shuffle: prev.queue.shuffle,
          }),
        };
      });
    },
    [],
  );

  const setQueue = useCallback(
    (queue: Queue, options?: { restartIfSame?: boolean }) => {
      const prev = playlistRef.current;
      if (!prev) return;
      setPlaylist({ ...prev, queue });
      // Même audio : l'élément ne change pas, on le relance à la main.
      if (options?.restartIfSame && currentId(queue) === currentId(prev.queue))
        restartCurrent();
    },
    [restartCurrent],
  );

  const isActive = useCallback(
    (id: number) => playlistRef.current?.id === id,
    [],
  );
  const isPlaying = useCallback(() => store.get().playing, [store]);

  const requestPlay = useCallback(() => {
    wantPlay.current = true;
    setNonce((n) => n + 1);
  }, []);

  const registerFullUi = useCallback(() => {
    setFullUi((n) => n + 1);
    return () => setFullUi((n) => n - 1);
  }, []);

  const rememberLabel = useCallback((id: string, name: string) => {
    setLabels((prev) => (prev[id] === name ? prev : { ...prev, [id]: name }));
  }, []);

  const value = useMemo<PlayerContext>(
    () => ({
      player,
      audioId,
      playlist,
      hooks,
      loadSingle,
      activatePlaylist,
      syncPlaylist,
      isActive,
      isPlaying,
      setQueue,
      requestPlay,
      registerFullUi,
      rememberLabel,
    }),
    // `player` change à chaque rendu mais ses fonctions sont stables ; le magasin porte la position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      audioId,
      playlist,
      loadSingle,
      activatePlaylist,
      syncPlaylist,
      isActive,
      isPlaying,
      setQueue,
      requestPlay,
      registerFullUi,
      rememberLabel,
      store,
      prefs.playbackRate,
      prefs.volume,
      prefs.echo,
    ],
  );

  const onAudioEnded = () => {
    const current = playlistRef.current;
    if (!current) {
      wantPlay.current = false;
      return;
    }
    const result = queueEnded(current.queue);
    if (!result.play) {
      wantPlay.current = false;
      return;
    }
    wantPlay.current = true;
    if (currentId(result.queue) === currentId(current.queue)) restartCurrent();
    else setPlaylist({ ...current, queue: result.queue });
  };
  const onAudioError = () => {
    const current = playlistRef.current;
    if (!current) {
      hooks.current.onError?.(
        "Lecture impossible pour cet audio dans ce navigateur.",
      );
      return;
    }
    const result = skipNext(current.queue);
    if (result.action === "move") {
      hooks.current.onError?.("Audio illisible. Passage au suivant.");
      setPlaylist({ ...current, queue: result.queue });
    } else wantPlay.current = false;
  };

  return (
    <Context.Provider value={value}>
      {children}
      {audioId ? (
        <audio
          key={audioId}
          ref={attachNode}
          src={`/api/sessions/${audioId}/audio`}
          preload="metadata"
          aria-label="Lecteur audio"
          style={{ display: "none" }}
          onPlay={() => {
            wantPlay.current = true;
          }}
          onPause={(event) => {
            const node = event.currentTarget;
            // Une pause de l'utilisateur coupe la suite ; la fin d'un audio et son retrait de la page, non.
            if (node.isConnected && !node.ended) wantPlay.current = false;
          }}
          onEnded={onAudioEnded}
          onError={onAudioError}
        />
      ) : null}
      {audioId && fullUi === 0 ? (
        <MiniPlayer
          player={player}
          audioId={audioId}
          label={labels[audioId] ?? "Récitation en cours"}
          onStop={() => {
            wantPlay.current = false;
            setPlaylist(null);
            setSingle(null);
          }}
        />
      ) : null}
    </Context.Provider>
  );
}
