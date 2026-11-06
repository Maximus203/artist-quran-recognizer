"use client";
import type { FreeSpeechMode } from "@/lib/export-video-free-speech";
import { useEffect, useRef, useState } from "react";
import type { VideoPrefs } from "@/lib/export-video-prefs";
import type { SavedVideo } from "@/lib/export-video-library";
import { fetchJobBackgroundVideo } from "@/lib/export-video-job-clip";
import { renderSessionVideo } from "@/lib/export-video-render";

/**
 * Page technique : le navigateur sans interface lancé par le serveur y fait le rendu d'une vidéo
 * demandée par l'API (même code que le formulaire de l'atelier). Les réglages viennent du serveur
 * (`window.__AQR_RENDER`) ; l'avancement et l'éventuelle erreur sont lus dans `window.__AQR_STATE`.
 * Elle ne montre aucune donnée : tout passe par l'API, avec le jeton de l'appelant.
 */
type Payload = {
  sessionId: string;
  jobId: string;
  prefs: VideoPrefs;
  hasBackground: boolean;
  /** Une vidéo de fond (muette) attend, lue par la route du job ; son identité nomme le fichier. */
  hasBackgroundVideo?: boolean;
  backgroundVideoId?: string | null;
  fileName?: string;
  ranges?: { start: number; end: number; name?: string }[];
  perVerse?: boolean;
  suggest?: "verse" | "passage";
  margins?: {
    leadIn?: number;
    tailOut?: number;
    snapToSilence?: boolean;
    mergeGap?: number;
  };
  padRanges?: boolean;
  freeSpeech?: FreeSpeechMode;
  /** Vidéo identique déjà gardée : récupérée sans être refaite (défaut). */
  reuse?: boolean;
};
type State = {
  progress?: string;
  /** Avancement de la vidéo en cours, de 0 à 1. */
  ratio?: number;
  error?: string;
  done?: boolean;
  /** Nombre de vidéos attendues (une par plage) : le serveur attend autant de téléchargements. */
  total?: number;
  files_done?: number;
  files_total?: number;
};

export function RenderClient() {
  const [text, setText] = useState("Rendu en préparation…");
  // Un seul rendu par page, même si React relance l'effet (mode strict de développement) :
  // sinon chaque vidéo serait produite et téléchargée deux fois.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const w = window as unknown as {
      __AQR_RENDER?: Payload;
      __AQR_STATE?: State;
    };
    const payload = w.__AQR_RENDER;
    if (!payload) {
      setText("Page technique : réservée au rendu des exports vidéo.");
      return;
    }
    const state: State = (w.__AQR_STATE = {});
    (async () => {
      let bgImage: File | null = null;
      if (payload.hasBackground) {
        const response = await fetch(
          `/api/sessions/${payload.sessionId}/export/video/jobs/${payload.jobId}/background`,
        );
        if (!response.ok) throw new Error("Image de fond introuvable.");
        const blob = await response.blob();
        bgImage = new File([blob], "background", { type: blob.type });
      }
      // Vidéo de fond choisie (muette) : envoyée au serveur avant l'export, lue ici par la route propre au job.
      const bgVideo = payload.hasBackgroundVideo
        ? await fetchJobBackgroundVideo(
            payload.sessionId,
            payload.jobId,
            payload.backgroundVideoId ?? null,
          )
        : null;
      // La page est connectée comme l'appelant : elle lit elle-même les vidéos déjà gardées.
      const existing = payload.reuse
        ? (
            (await fetch(`/api/sessions/${payload.sessionId}/videos`).then(
              (r) => (r.ok ? r.json() : { videos: [] }),
            )) as { videos: SavedVideo[] }
          ).videos
        : [];
      await renderSessionVideo({
        sessionId: payload.sessionId,
        prefs: payload.prefs,
        bgImage,
        bgVideo,
        existing,
        reuse: payload.reuse !== false,
        fileName: payload.fileName,
        ranges: payload.ranges,
        perVerse: payload.perVerse,
        suggest: payload.suggest,
        margins: payload.margins,
        padRanges: payload.padRanges,
        freeSpeech: payload.freeSpeech,
        onCount: (count) => {
          state.total = count;
          state.files_total = count;
          state.files_done = 0;
        },
        onFile: (progress) => {
          // Avancement réel de la vidéo en cours (0 à 1) ; remis à zéro quand elle est prête.
          if (progress.phase === "done") {
            state.files_done = progress.index + 1;
            state.ratio = 0;
          } else state.ratio = progress.ratio;
        },
        onProgress: (message) => {
          state.progress = message;
          setText(message);
        },
      });
      state.done = true;
    })().catch((error: unknown) => {
      state.error =
        error instanceof Error ? error.message : "Rendu impossible.";
      setText(state.error);
    });
  }, []);
  return (
    <main style={{ padding: 24 }} data-testid="render-video">
      <p role="status">{text}</p>
    </main>
  );
}
