"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { LiveClient } from "@/lib/live-client";
import { LIVE_UI } from "@/lib/live-config";
import { micErrorKey } from "@/lib/live-errors";
import { liveSupport, openMic, type MicCapture } from "@/lib/live-audio";
import { verseName } from "@/lib/live-format";
import {
  fetchLiveToken,
  keepRecording,
  openBrowserSocket,
} from "@/lib/live-net";
import { PcmPipeline } from "@/lib/live-pcm";
import {
  announceChange,
  historyRows,
  initialState,
  isLive,
  reduce,
  type LiveState,
} from "@/lib/live-store";
import { useShell } from "../shell";

/**
 * Le chef d'orchestre de l'écran « En direct » côté navigateur : relie le micro, le client du flux, le
 * réducteur et les services du navigateur (verrou d'écran, visibilité, fermeture de page). Toute la
 * logique métier est ailleurs et testée (`lib/live-*.ts`) ; ici, seulement la colle.
 */
const TRANSLATION_ID = "french_hameedullah";
const LEAVE_WARNING =
  "Une écoute est en cours, ou un enregistrement n’est pas encore gardé. Quitter cette page arrête l’écoute et efface le son de ce navigateur. Quitter quand même ?";

function readTech(): boolean {
  try {
    const raw = window.localStorage.getItem(LIVE_UI.techStorageKey);
    return raw
      ? (JSON.parse(raw) as { technical?: unknown }).technical === true
      : false;
  } catch {
    return false;
  }
}

function writeTech(value: boolean): void {
  try {
    window.localStorage.setItem(
      LIVE_UI.techStorageKey,
      JSON.stringify({ technical: value }),
    );
  } catch {
    // stockage indisponible : l'interrupteur vaut pour cette page seulement
  }
}

const hhmm = (date: Date): string =>
  `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

export type LiveApi = ReturnType<typeof useLive>;

export function useLive() {
  const { prefs } = useShell();
  const [state, dispatch] = useReducer(reduce, undefined, initialState);
  const stateRef = useRef<LiveState>(state);
  stateRef.current = state;
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const [technical, setTechnicalState] = useState(false);
  const [announcement, setAnnouncement] = useState({ text: "", n: 0 });
  const [retryIn, setRetryIn] = useState<number | null>(null);
  const [wakeHeld, setWakeHeld] = useState(false);
  const [keepFile, setKeepFile] = useState<File | null>(null);
  const [undoIn, setUndoIn] = useState<number | null>(null);

  const clientRef = useRef<LiveClient | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const pipeRef = useRef<PcmPipeline | null>(null);
  const fileRef = useRef<File | null>(null);
  const discardTimer = useRef<number | null>(null);
  const starting = useRef(false);

  useEffect(() => {
    setTechnicalState(readTech());
  }, []);
  const setTechnical = useCallback((value: boolean) => {
    setTechnicalState(value);
    writeTech(value);
  }, []);

  // ───────────── Micro et flux ─────────────
  const releaseMic = useCallback(async () => {
    const mic = micRef.current;
    micRef.current = null;
    pipeRef.current = null;
    await mic?.close().catch(() => undefined);
  }, []);

  const teardown = useCallback(() => {
    clientRef.current?.dispose();
    clientRef.current = null;
    void releaseMic();
  }, [releaseMic]);

  const start = useCallback(async () => {
    const phase = stateRef.current.phase;
    if (
      starting.current ||
      (phase !== "idle" && phase !== "error" && phase !== "ended")
    )
      return;
    starting.current = true;
    if (discardTimer.current !== null)
      window.clearTimeout(discardTimer.current);
    discardTimer.current = null;
    fileRef.current = null;
    setKeepFile(null);
    setUndoIn(null);
    setRetryIn(null);
    teardown();
    dispatch({ type: "start", nowMs: Date.now() });
    try {
      const support = liveSupport();
      if (!support.secure || !support.hasApi) {
        dispatch({
          type: "failed",
          nowMs: Date.now(),
          key: micErrorKey(null, support),
        });
        return;
      }
      const client = new LiveClient({
        now: () => Date.now(),
        setTimer: (fn, ms) => window.setTimeout(fn, ms),
        clearTimer: (handle) => window.clearTimeout(handle as number),
        openSocket: openBrowserSocket,
        fetchToken: fetchLiveToken,
        dispatch,
        options: {
          translation: prefsRef.current.translation ? TRANSLATION_ID : "none",
          technical: readTech(),
        },
      });
      let mic: MicCapture;
      try {
        mic = await openMic((samples, rate) => {
          const pipe = (pipeRef.current ??= new PcmPipeline(
            rate,
            LIVE_UI.sampleRate,
            (LIVE_UI.blockMs * LIVE_UI.sampleRate) / 1000,
          ));
          const { blocks, level } = pipe.push(samples);
          blocks.forEach((block, i) =>
            client.onAudio(block, i === 0 ? level : 0),
          );
        });
      } catch (error) {
        dispatch({
          type: "failed",
          nowMs: Date.now(),
          key: micErrorKey(error, support),
        });
        return;
      }
      if (stateRef.current.phase !== "permission") {
        // annulé pendant la demande d'accès
        await mic.close().catch(() => undefined);
        return;
      }
      micRef.current = mic;
      clientRef.current = client;
      dispatch({
        type: "mic_granted",
        nowMs: Date.now(),
        keepAvailable: mic.recorder !== null,
      });
      client.open();
    } finally {
      starting.current = false;
    }
  }, [teardown]);

  const pause = useCallback(() => {
    if (stateRef.current.phase !== "listening") return;
    micRef.current?.setMuted(true);
    micRef.current?.recorder?.pause();
    clientRef.current?.pause();
    dispatch({ type: "pause", nowMs: Date.now() });
  }, []);

  const resume = useCallback(() => {
    if (stateRef.current.phase !== "paused") return;
    micRef.current?.setMuted(false);
    micRef.current?.recorder?.resume();
    clientRef.current?.resume();
    dispatch({ type: "resume", nowMs: Date.now() });
  }, []);

  const stop = useCallback(async () => {
    const phase = stateRef.current.phase;
    if (phase !== "listening" && phase !== "paused") return;
    const client = clientRef.current;
    const mic = micRef.current;
    const rest = pipeRef.current?.flush();
    if (rest && client) client.onAudio(rest, 0);
    dispatch({ type: "stop", nowMs: Date.now() });
    client?.stop();
    mic?.setMuted(true);
    const file = (await mic?.recorder?.finish().catch(() => null)) ?? null;
    fileRef.current = file;
    setKeepFile(file);
    micRef.current = null;
    pipeRef.current = null;
    await mic?.close().catch(() => undefined);
  }, []);

  const retryNow = useCallback(() => clientRef.current?.retryNow(), []);

  const cancel = useCallback(() => {
    teardown();
    dispatch({ type: "cancel" });
  }, [teardown]);

  // La fin d'écoute (FINAL ou erreur) libère le micro s'il ne l'est pas déjà.
  useEffect(() => {
    if (state.phase === "error" || state.phase === "ended") {
      if (state.phase === "ended" && micRef.current && !fileRef.current) {
        const mic = micRef.current;
        void (async () => {
          const file = (await mic.recorder?.finish().catch(() => null)) ?? null;
          fileRef.current = file;
          setKeepFile(file);
        })();
      }
      void releaseMic();
    }
  }, [state.phase, releaseMic]);

  useEffect(() => () => teardown(), [teardown]);

  // ───────────── Horloge de l'interface (1 fois par seconde suffit : patience, son gardé) ─────────────
  useEffect(() => {
    if (
      state.phase === "idle" ||
      state.phase === "ended" ||
      state.phase === "error"
    )
      return;
    const timer = window.setInterval(
      () => dispatch({ type: "tick", nowMs: Date.now() }),
      500,
    );
    return () => window.clearInterval(timer);
  }, [state.phase]);

  // ───────────── Nouvel essai automatique (service complet, trop de demandes) ─────────────
  useEffect(() => {
    const retryable =
      state.phase === "error" &&
      state.retryAfterS !== null &&
      (state.errorKey === "server_busy" || state.errorKey === "rate_limited");
    if (!retryable) {
      setRetryIn(null);
      return;
    }
    let left = Math.max(1, Math.round(state.retryAfterS ?? 1));
    setRetryIn(left);
    const timer = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        window.clearInterval(timer);
        setRetryIn(null);
        void start();
      } else setRetryIn(left);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [state.phase, state.errorKey, state.retryAfterS, start]);

  // ───────────── Écran maintenu allumé, onglet caché, page quittée ─────────────
  const listening = isLive(state.phase);
  useEffect(() => {
    if (!listening) {
      setWakeHeld(false);
      return;
    }
    type Sentinel = { release(): Promise<void>; released: boolean };
    let sentinel: Sentinel | null = null;
    let cancelled = false;
    const wake = (
      navigator as Navigator & {
        wakeLock?: { request(type: "screen"): Promise<Sentinel> };
      }
    ).wakeLock;
    const acquire = async () => {
      if (!wake || document.visibilityState !== "visible") return;
      try {
        const lock = await wake.request("screen");
        if (cancelled) {
          void lock.release();
          return;
        }
        sentinel = lock;
        setWakeHeld(true);
      } catch {
        setWakeHeld(false);
      }
    };
    void acquire();
    const onVisible = () => {
      dispatch({
        type: "visibility",
        nowMs: Date.now(),
        hidden: document.visibilityState === "hidden",
      });
      if (document.visibilityState === "visible") void acquire();
      else setWakeHeld(false);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
      setWakeHeld(false);
    };
  }, [listening]);

  useEffect(() => {
    const unsaved =
      isLive(state.phase) ||
      (state.phase === "ended" &&
        keepFile !== null &&
        state.keep.state === "idle");
    if (!unsaved) return;
    const onBefore = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onHide = () => clientRef.current?.dispose();
    // Un lien de l'atelier quitte la page sans `beforeunload` (navigation côté client) : même avertissement.
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      const link = (
        event.target as HTMLElement | null
      )?.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download"))
        return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      if (!window.confirm(LEAVE_WARNING)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBefore);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBefore);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("click", onClick, true);
    };
  }, [state.phase, state.keep.state, keepFile]);

  // ───────────── Annonces (une seule région vivante, au plus une toutes les 2,5 s) ─────────────
  const prevRef = useRef<LiveState | null>(null);
  const lastAnnounce = useRef(0);
  const pending = useRef<string | null>(null);
  const announceTimer = useRef<number | null>(null);
  const say = useCallback((text: string) => {
    lastAnnounce.current = Date.now();
    pending.current = null;
    setAnnouncement((a) => ({ text, n: a.n + 1 }));
  }, []);
  useEffect(() => {
    const message = announceChange(prevRef.current, state, verseName);
    prevRef.current = state;
    if (!message) return;
    const wait = lastAnnounce.current + LIVE_UI.announceGapMs - Date.now();
    if (wait <= 0) {
      say(message);
      return;
    }
    pending.current = message;
    if (announceTimer.current === null)
      announceTimer.current = window.setTimeout(() => {
        announceTimer.current = null;
        if (pending.current) say(pending.current);
      }, wait);
  }, [state, say]);
  useEffect(
    () => () => {
      if (announceTimer.current !== null)
        window.clearTimeout(announceTimer.current);
    },
    [],
  );

  // ───────────── Fin d'écoute : garder, copier, ne rien garder ─────────────
  const keep = useCallback(async () => {
    const file = fileRef.current;
    if (!file) {
      dispatch({
        type: "keep",
        keep: {
          state: "failed",
          message:
            "L’enregistrement n’est plus disponible dans cette page : il n’a pas pu être gardé.",
        },
      });
      return;
    }
    dispatch({ type: "keep", keep: { state: "sending", progress: 0 } });
    try {
      const result = await keepRecording(
        file,
        {
          visibility: prefsRef.current.defaultVisibility,
          name: `Récitation en direct, ${hhmm(new Date())}`,
        },
        (progress) =>
          dispatch({ type: "keep", keep: { state: "sending", progress } }),
      );
      fileRef.current = null;
      setKeepFile(null);
      dispatch({
        type: "keep",
        keep: { state: "queued", sessionId: result.id },
      });
    } catch (error) {
      dispatch({
        type: "keep",
        keep: { state: "failed", message: (error as Error).message },
      });
    }
  }, []);

  const discard = useCallback(() => {
    dispatch({ type: "keep", keep: { state: "discarded" } });
    let left = LIVE_UI.discardUndoS;
    setUndoIn(left);
    const tick = () => {
      left -= 1;
      if (left <= 0) {
        fileRef.current = null;
        setKeepFile(null);
        setUndoIn(null);
        discardTimer.current = null;
      } else {
        setUndoIn(left);
        discardTimer.current = window.setTimeout(tick, 1000);
      }
    };
    discardTimer.current = window.setTimeout(tick, 1000);
  }, []);

  const undoDiscard = useCallback(() => {
    if (discardTimer.current === null) return;
    window.clearTimeout(discardTimer.current);
    discardTimer.current = null;
    setUndoIn(null);
    dispatch({ type: "keep", keep: { state: "idle" } });
  }, []);

  const copyList = useCallback(async () => {
    const rows = historyRows(stateRef.current)
      .slice()
      .reverse()
      .map((row) => {
        if (row.kind === "verse")
          return `${verseName(row.ref)} · ${row.revised ? "corrigé" : row.status === "inferred" ? "déduit de la position" : "reconnu"}`;
        if (row.kind === "unres") return "Passage non nommé";
        if (row.kind === "nq") return "Parole non coranique";
        return null;
      })
      .filter((line): line is string => line !== null)
      .join("\n");
    try {
      await navigator.clipboard.writeText(rows);
      say("Liste copiée.");
    } catch {
      say("La copie a échoué : sélectionne la liste et copie-la à la main.");
    }
  }, [say]);

  return {
    state,
    technical,
    setTechnical,
    announcement,
    retryIn,
    wakeHeld,
    keepFile,
    undoIn,
    start,
    pause,
    resume,
    stop,
    cancel,
    retryNow,
    keep,
    discard,
    undoDiscard,
    copyList,
  };
}
