"use client";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import {
  captureFilmFrames,
  ProbeError,
  readVideoFacts,
  type VideoFacts,
} from "@/lib/background-video-probe";
import {
  ClipUploadError,
  fetchClipLimits,
  fetchPreparedClip,
  removeBackgroundVideo,
  uploadBackgroundVideo,
  type ClipUploadIo,
  type ClipView,
} from "@/lib/background-video-client";
import { flowReducer, IDLE, type Flow } from "@/lib/background-video-flow";
import {
  clipExplanation,
  DEFAULT_CLIP_LIMITS,
  type ClipLimits,
} from "@/lib/background-video-policy";
import { formatClockTenths, MODE_CHOICES } from "@/lib/background-video-view";
import type {
  BackgroundVideo,
  BackgroundVideoMode,
} from "@/lib/export-video-model";
import {
  BackgroundVideoView,
  type BackgroundVideoValue,
  type OffsetSource,
} from "./background-video-view";

export type { BackgroundVideoValue } from "./background-video-view";

/**
 * Section « Vidéo de fond » de l'export, AUTONOME : elle ne connaît ni le panneau actuel ni l'éditeur qui la
 * accueillera. Le parent lui donne la session, la durée de la récitation et la valeur courante (ou `null`), et
 * reçoit les changements par `onChange`.
 *
 * Ce qu'elle fait : choisir « Ma vidéo… » → lire sa durée sur l'appareil → l'envoyer au serveur (l'export est rendu
 * là-bas) en suivant la progression → dire en clair ce que la vidéo fera sous la récitation (boucle, portion, rien
 * à régler) → laisser régler. Ce qu'elle ne fait pas : écrire dans les préférences ni lancer l'export ; le parent
 * lit `backgroundVideoPrefs(value)` et `backgroundVideoRequest(value)`.
 *
 * Un seul départ vaut pour toutes les parties exportées (`parts`) : il est borné pour chacune au rendu.
 */
export type BackgroundVideoSectionProps = {
  /** La session dont on exporte la récitation : la vidéo lui est rattachée sur le serveur. */
  sessionId: string;
  /** Durée (s) de la récitation exportée la plus longue : de quoi dire « plus courte / plus longue / même durée ». */
  recitationSeconds: number;
  /** Nombre de parties exportées (défaut 1). Au-delà, la section dit qu'un seul départ vaut pour toutes. */
  parts?: number;
  /** La vidéo choisie (prête sur le serveur) ou `null`. Le parent la garde le temps de l'édition. */
  value: BackgroundVideoValue | null;
  /** Nouvelle valeur : vidéo prête, mode ou départ changés, ou `null` quand on la retire. */
  onChange: (value: BackgroundVideoValue | null) => void;
  /** Services remplaçables (tests, aperçus). Par défaut : le serveur et le navigateur. */
  services?: Partial<BackgroundVideoServices>;
};

export type BackgroundVideoServices = {
  fetchLimits: (sessionId: string) => Promise<ClipLimits>;
  readFacts: (file: File) => Promise<VideoFacts>;
  captureFrames: typeof captureFilmFrames;
  upload: (
    sessionId: string,
    file: File,
    io: ClipUploadIo,
  ) => Promise<ClipView>;
  remove: (sessionId: string, id: string) => Promise<void>;
  fetchPrepared: (sessionId: string, id: string, name: string) => Promise<File>;
};

const DEFAULT_SERVICES: BackgroundVideoServices = {
  fetchLimits: fetchClipLimits,
  readFacts: (file) => readVideoFacts(file),
  captureFrames: captureFilmFrames,
  upload: uploadBackgroundVideo,
  remove: removeBackgroundVideo,
  fetchPrepared: fetchPreparedClip,
};

/** Nombre de vignettes de la bande « film ». */
const FRAME_COUNT = 12;

/** Ce que le parent range dans ses réglages (`backgroundVideo`) : nom, départ, comportement — jamais le fichier. */
export function backgroundVideoPrefs(
  value: BackgroundVideoValue,
): BackgroundVideo {
  return {
    file: value.name.slice(0, 160) || "video",
    offset: value.offset,
    mode: value.mode,
  };
}

/** Ce que le parent passe à `exportVideoRequest` pour que le JSON de l'API désigne la vidéo. */
export const backgroundVideoRequest = (value: BackgroundVideoValue | null) => ({
  backgroundVideoUploadId: value?.uploadId ?? null,
});

const modeTitle = (mode: BackgroundVideoMode) =>
  MODE_CHOICES.find((choice) => choice.mode === mode)?.title ?? mode;

export function BackgroundVideoSection(props: BackgroundVideoSectionProps) {
  const { sessionId, recitationSeconds, value, onChange } = props;
  const services = { ...DEFAULT_SERVICES, ...props.services };
  const svc = useRef(services);
  svc.current = services;
  const [flow, dispatch] = useReducer(
    flowReducer,
    value ? ({ phase: "ready" } as Flow) : IDLE,
  );
  const [limits, setLimits] = useState<ClipLimits>(DEFAULT_CLIP_LIMITS);
  const [frames, setFrames] = useState<Array<string | null>>([]);
  const [announcement, setAnnouncement] = useState("");
  const control = useRef<AbortController | null>(null);
  const facts = useRef<VideoFacts | null>(null);
  // Les derniers réglages du parent, lus par les rappels asynchrones (un envoi dure plus qu'un rendu).
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };

  // Les plafonds, dits avant le choix du fichier.
  useEffect(() => {
    let alive = true;
    void svc.current.fetchLimits(sessionId).then((found) => {
      if (alive) setLimits(found);
    });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // Le parent peut changer la valeur sous nos pieds (retrait, autre session) : l'écran suit.
  useEffect(() => {
    if (value && flow.phase === "idle") dispatch({ type: "ready" });
    if (!value && flow.phase === "ready") dispatch({ type: "cancel" });
  }, [value, flow.phase]);

  // Vignettes de la bande « film » : une fois par fichier, sans bloquer l'écran, arrêtées si on change de vidéo.
  const file = value?.file ?? null;
  useEffect(() => {
    setFrames([]);
    if (!file) return;
    const stop = new AbortController();
    const found: Array<string | null> = Array.from(
      { length: FRAME_COUNT },
      () => null,
    );
    void svc.current
      .captureFrames(file, FRAME_COUNT, {
        signal: stop.signal,
        onFrame: (index, url) => {
          found[index] = url;
          if (!stop.signal.aborted) setFrames([...found]);
        },
      })
      .catch(() => undefined);
    return () => stop.abort();
  }, [file]);

  // Quitter l'écran arrête l'envoi en cours (le serveur supprime ce qu'il avait reçu).
  useEffect(() => () => control.current?.abort(), []);

  const run = useCallback(
    async (chosen: File, resumeId?: string) => {
      control.current?.abort();
      const controller = new AbortController();
      control.current = controller;
      const previous = latest.current.value;
      try {
        if (!resumeId) {
          dispatch({ type: "pick", file: chosen });
          setAnnouncement("Lecture de la vidéo…");
          facts.current = null;
          try {
            facts.current = await svc.current.readFacts(chosen);
          } catch (error) {
            // Un son seul n'est pas un fond. Une vidéo que CE navigateur ne lit pas, en revanche, peut être lue
            // par le serveur : on l'envoie quand même, c'est lui qui juge.
            if (error instanceof ProbeError && error.code === "no_video")
              throw new ClipUploadError(
                "no_video",
                clipExplanation("no_video", {}),
              );
          }
          if (controller.signal.aborted) return;
        }
        dispatch({ type: "probed" });
        setAnnouncement("Envoi de la vidéo au serveur.");
        let phase = "sending";
        const view = await svc.current.upload(sessionId, chosen, {
          signal: controller.signal,
          limits,
          seconds: facts.current?.duration,
          resumeId,
          onProgress: (progress) => {
            dispatch({ type: "progress", ...progress });
            if (progress.phase !== phase) {
              phase = progress.phase;
              setAnnouncement(
                phase === "preparing"
                  ? "Envoi terminé. Le serveur prépare la vidéo."
                  : "Envoi de la vidéo au serveur.",
              );
            }
          },
        });
        // Le navigateur lit l'original : on l'utilise. Sinon (HEVC, MKV…), l'aperçu lit la copie du serveur.
        const preview = facts.current
          ? chosen
          : await svc.current
              .fetchPrepared(sessionId, view.id, chosen.name)
              .catch(() => chosen);
        const next: BackgroundVideoValue = {
          file: preview,
          uploadId: view.id,
          name: chosen.name,
          duration: view.duration ?? facts.current?.duration ?? 0,
          width: view.width ?? facts.current?.width ?? 0,
          height: view.height ?? facts.current?.height ?? 0,
          offset: 0,
          mode: previous?.mode ?? "loop",
        };
        latest.current.onChange(next);
        dispatch({ type: "ready" });
        setAnnouncement("Vidéo de fond prête.");
        // L'ancienne vidéo n'est retirée du serveur qu'une fois la nouvelle prête : un échec ne perd rien.
        if (previous && previous.uploadId !== view.id)
          void svc.current.remove(sessionId, previous.uploadId);
      } catch (error) {
        if (
          controller.signal.aborted &&
          !(error instanceof ClipUploadError && error.code !== "interrupted")
        ) {
          if (!previous) dispatch({ type: "cancel" });
          else dispatch({ type: "ready" });
          return;
        }
        const known =
          error instanceof ClipUploadError
            ? error
            : new ClipUploadError("server", clipExplanation("server", {}));
        dispatch({
          type: "failed",
          error: {
            code: known.code,
            message: known.message,
            resumeId: known.resumeId,
          },
        });
        setAnnouncement(known.message);
      }
    },
    [sessionId, limits],
  );

  const onPick = useCallback((chosen: File) => void run(chosen), [run]);

  const onRetry = useCallback(() => {
    if (flow.phase === "failed") {
      dispatch({ type: "retry" });
      void run(flow.file, flow.error.resumeId);
    }
  }, [flow, run]);

  const onCancel = useCallback(() => {
    // Pendant un envoi : on l'arrête (le serveur supprime ce qu'il a reçu). Après une coupure : l'envoi gardé
    // pour reprendre est supprimé à la main.
    if (flow.phase === "failed" && flow.error.resumeId)
      void svc.current.remove(sessionId, flow.error.resumeId);
    control.current?.abort();
    dispatch({ type: latest.current.value ? "ready" : "cancel" });
    setAnnouncement("Envoi annulé.");
  }, [flow, sessionId]);

  const onRemove = useCallback(() => {
    const current = latest.current.value;
    if (!current) return;
    void svc.current.remove(sessionId, current.uploadId);
    latest.current.onChange(null);
    dispatch({ type: "cancel" });
    setAnnouncement("Vidéo de fond retirée.");
  }, [sessionId]);

  const onMode = useCallback((mode: BackgroundVideoMode) => {
    const current = latest.current.value;
    if (!current) return;
    latest.current.onChange({ ...current, mode });
    setAnnouncement(`Comportement : ${modeTitle(mode)}.`);
  }, []);

  const onOffset = useCallback((offset: number, source: OffsetSource) => {
    const current = latest.current.value;
    if (!current) return;
    latest.current.onChange({ ...current, offset });
    // Le curseur dit déjà sa valeur ; les boutons, eux, ont besoin d'une annonce.
    if (source === "button")
      setAnnouncement(`Début de la portion : ${formatClockTenths(offset)}.`);
  }, []);

  // « Changer » depuis une vidéo prête : le flux repart de la lecture sans perdre la valeur tant que la nouvelle n'est pas prête.
  const shown: Flow =
    value && flow.phase === "idle" ? { phase: "ready" } : flow;

  return (
    <BackgroundVideoView
      flow={shown}
      value={flow.phase === "ready" || flow.phase === "idle" ? value : null}
      limits={limits}
      recitationSeconds={recitationSeconds}
      parts={props.parts ?? 1}
      frames={frames}
      announcement={announcement}
      onPick={onPick}
      onCancel={onCancel}
      onRetry={onRetry}
      onRemove={onRemove}
      onMode={onMode}
      onOffset={onOffset}
    />
  );
}
