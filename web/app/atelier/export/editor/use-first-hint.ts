"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * L'aide du premier affichage : montrée UNE seule fois par appareil (la mémoire du navigateur la retient),
 * puis plus jamais. Elle se retire d'elle-même après quelques secondes, ou dès que la personne touche
 * quelque chose (`dismiss`). Sans mémoire de navigateur (navigation privée), elle se montre une fois par
 * ouverture : mieux vaut une aide de trop qu'une aide absente.
 */
export const FIRST_HINT_KEY = "aqr.export-editor.hint.v1";
export const FIRST_HINT_MS = 6000;

export function useFirstHint(
  key: string = FIRST_HINT_KEY,
  /** Faux : l'aide attend (le pas à pas ne la montre qu'en arrivant à l'étape des textes). */
  enabled: boolean = true,
  /** `null` : l'aide reste jusqu'à ce qu'on la ferme (un texte à lire, pas une main qui touche). */
  hideAfterMs: number | null = FIRST_HINT_MS,
): {
  show: boolean;
  dismiss: () => void;
  /** Rouvrir l'aide à la demande (bouton « ? »). */
  reopen: () => void;
} {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    let seen = false;
    try {
      seen = window.localStorage.getItem(key) !== null;
      if (!seen) window.localStorage.setItem(key, "1");
    } catch {
      // Pas de mémoire disponible : l'aide se montre cette fois-ci.
    }
    if (!seen) {
      setShow(true);
      if (hideAfterMs !== null)
        timer = window.setTimeout(() => setShow(false), hideAfterMs);
    }
    return () => window.clearTimeout(timer);
  }, [key, enabled, hideAfterMs]);
  const dismiss = useCallback(() => setShow(false), []);
  const reopen = useCallback(() => setShow(true), []);
  return { show, dismiss, reopen };
}
