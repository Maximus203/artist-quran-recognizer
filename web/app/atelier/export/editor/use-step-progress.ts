"use client";
import { useCallback, useEffect, useState } from "react";
import {
  loadProgress,
  moveTo,
  saveProgress,
  type StepId,
  type StepsProgress,
  type StepsStorage,
} from "@/lib/export-video-steps";

/** La mémoire de l'onglet : elle s'efface avec lui, et peut manquer (navigation privée, réglage bloqué). */
function tabStorage(): StepsStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Où l'on en est dans le pas à pas, mémorisé pour CETTE récitation dans cet onglet : quitter l'éditeur puis
 * revenir (ou recharger la page) ramène à la même étape. `initial` sert aux tests et à l'aperçu d'une étape
 * précise ; en usage normal, rien n'est donné.
 */
export function useStepProgress(
  sessionId: string,
  initial?: StepsProgress,
): { progress: StepsProgress; go: (target: StepId) => void } {
  const [progress, setProgress] = useState<StepsProgress>(
    () => initial ?? loadProgress(tabStorage(), sessionId),
  );
  const go = useCallback(
    (target: StepId) => setProgress((current) => moveTo(current, target)),
    [],
  );
  useEffect(() => {
    saveProgress(tabStorage(), sessionId, progress);
  }, [sessionId, progress]);
  return { progress, go };
}
