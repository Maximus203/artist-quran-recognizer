"use client";
import { useEffect, useRef } from "react";
import { bindBackClose } from "@/lib/back-close";

/**
 * Tant que `open` est vrai (une feuille de réglages, une fenêtre), le bouton Retour du navigateur la ferme au
 * lieu de quitter l'éditeur. `onClose` est celui de la feuille : il est appelé quand la personne appuie sur
 * Retour ; fermer par un autre chemin (« Terminé », Échap) retire seulement l'entrée d'historique ajoutée.
 */
export function useBackClose(open: boolean, onClose: () => void): void {
  const latest = useRef(onClose);
  latest.current = onClose;
  useEffect(() => {
    if (!open) return;
    return bindBackClose(window, () => latest.current());
  }, [open]);
}
