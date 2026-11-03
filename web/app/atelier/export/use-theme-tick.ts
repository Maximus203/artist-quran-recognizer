"use client";
import { useEffect, useState } from "react";

/**
 * Un compteur qui change quand le thème (clair ou sombre) change : un canevas dessine avec les couleurs des
 * tokens, lues au moment du dessin, donc il doit se redessiner à ce moment-là (la frise des passages et
 * l'onde de la table de montage s'en servent).
 */
export function useThemeTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const bump = () => setTick((n) => n + 1);
    media.addEventListener("change", bump);
    const observer = new MutationObserver(bump);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
    });
    return () => {
      media.removeEventListener("change", bump);
      observer.disconnect();
    };
  }, []);
  return tick;
}

/** La couleur calculée d'un token (`--accent`…), lue sur un élément-sonde caché. */
export function tokenColor(probe: HTMLElement, token: string): string {
  probe.style.color = `var(${token})`;
  return getComputedStyle(probe).color;
}
