"use client";
import { useEffect, useState } from "react";
import type { ListeningState } from "./console";

export type Peaks = { duration: number; peaks: number[] };

/**
 * Forme d'onde d'une récitation : crêtes de la copie d'écoute, calculées par le serveur. `listening` dit si
 * l'écoute est celle du moteur (`ready`) ou le fichier original (`fallback`, position approximative) ;
 * dans ce dernier cas `onFallback` reçoit l'explication à montrer.
 */
export function usePeaks(
  sessionId: string | null,
  onFallback: (message: string) => void,
) {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  const [listening, setListening] = useState<ListeningState>("pending");
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setPeaks(null);
    setListening("pending");
    // `no-cache` : le navigateur revalide (ETag) et réutilise ses crêtes si l'audio n'a pas changé.
    fetch(`/api/sessions/${sessionId}/peaks`, { cache: "no-cache" })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        if (cancelled) return;
        setPeaks({ duration: data.duration, peaks: data.peaks });
        setListening("ready");
      })
      .catch((e) => {
        if (cancelled) return;
        setListening("fallback");
        onFallback(
          `${e instanceof Error ? e.message : "Copie d’écoute indisponible"}. Lecture du fichier original : le positionnement peut y être décalé de plusieurs secondes.`,
        );
      });
    return () => {
      cancelled = true;
    };
    // `onFallback` est lu à l'échec seulement : sa nouvelle identité ne doit pas recharger les crêtes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);
  return { peaks, listening };
}
