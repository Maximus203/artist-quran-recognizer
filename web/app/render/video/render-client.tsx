"use client";
import { useEffect, useRef, useState } from "react";
import type { VideoPrefs } from "@/lib/export-video-prefs";
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
};
type State = {
  progress?: string;
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
      await renderSessionVideo({
        sessionId: payload.sessionId,
        prefs: payload.prefs,
        bgImage,
        fileName: payload.fileName,
        ranges: payload.ranges,
        perVerse: payload.perVerse,
        suggest: payload.suggest,
        margins: payload.margins,
        padRanges: payload.padRanges,
        onCount: (count) => {
          state.total = count;
          state.files_total = count;
          state.files_done = 0;
        },
        onFile: (progress) => {
          if (progress.phase === "done") state.files_done = progress.index + 1;
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
