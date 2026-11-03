"use client";
import { useEffect, useRef } from "react";
import { drawWaveBars, type WavePeaks } from "@/lib/export-wave";
import { tokenColor, useThemeTick } from "./use-theme-tick";

/**
 * L'onde sonore d'une piste, dessinée sur un canevas à partir des crêtes de la session. Le dessin lui-même est
 * dans `lib/export-wave.ts` (le même que celui de la frise des passages) ; ce composant ne fait que poser le
 * canevas à la bonne taille et choisir les couleurs dans les tokens (relues au changement de thème).
 *
 * Deux couches se superposent dans la table de montage : `idle` (toute l'onde, en gris) et `played` (en couleur
 * d'accent), que le parent rogne par CSS jusqu'à la tête de lecture — sans jamais redessiner à chaque image.
 */
export type WaveLayer = "idle" | "played";

const TOKENS = {
  /** Barre dans une plage exportée, onde au repos. */
  inside: "--text-3",
  /** Barre hors de toute plage : plus claire, elle ne sera pas dans la vidéo. */
  outside: "--wave",
  /** Barre déjà lue. */
  played: "--accent",
} as const;

export function WaveCanvas({
  peaks,
  duration,
  width,
  height,
  layer,
  included,
}: {
  peaks: WavePeaks | null;
  duration: number;
  /** Largeur et hauteur de la piste (px CSS). */
  width: number;
  height: number;
  layer: WaveLayer;
  /** Cet instant est-il dans une plage exportée ? (sinon la barre est éteinte) */
  included: (t: number) => boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const theme = useThemeTick();

  useEffect(() => {
    const canvas = canvasRef.current;
    const probe = probeRef.current;
    if (!canvas || !probe || !(width > 0) || !(height > 0)) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const inside = tokenColor(probe, TOKENS.inside);
    const outside = tokenColor(probe, TOKENS.outside);
    const played = tokenColor(probe, TOKENS.played);
    drawWaveBars(g, {
      peaks,
      view: { a: 0, b: duration },
      width,
      step: 4,
      barWidth: 2.4,
      mid: height / 2,
      amp: height / 2 - 3,
      colorAt: (t) =>
        layer === "played" ? played : included(t) ? inside : outside,
    });
  }, [peaks, duration, width, height, layer, included, theme]);

  return (
    <>
      <span ref={probeRef} hidden />
      <canvas
        ref={canvasRef}
        className="xt-wave-canvas"
        data-layer={layer}
        aria-hidden="true"
        style={{ width, height }}
      />
    </>
  );
}
