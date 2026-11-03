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
): {
  show: boolean;
  dismiss: () => void;
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
      timer = window.setTimeout(() => setShow(false), FIRST_HINT_MS);
    }
    return () => window.clearTimeout(timer);
  }, [key, enabled]);
  const dismiss = useCallback(() => setShow(false), []);
  return { show, dismiss };
}
