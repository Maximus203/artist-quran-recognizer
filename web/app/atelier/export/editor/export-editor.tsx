"use client";
import { useEffect, useState } from "react";
import { DesktopEditor } from "./desktop-editor";
import { editorFor } from "./editor-registry";
import {
  DEFAULT_EDITOR_MODE,
  type EditorMode,
  type EditorProps,
} from "./editor-types";

/** Le seuil du bureau : la même largeur que le reste de l'export (`video-panel`). */
export const DESKTOP_QUERY = "(min-width: 1024px)";

/**
 * La condition d'écran, lue dès le premier rendu : l'éditeur n'apparaît qu'après le chargement des données (jamais
 * dans le HTML du serveur), et un premier rendu « téléphone » sur un grand écran monterait pour rien l'éditeur du
 * téléphone (et userait son aide du premier affichage).
 */
export function useScreen(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/**
 * L'éditeur de la vidéo d'export. Au bureau (1024 px et plus), TOUJOURS la vue unifiée, quel que soit le
 * mode : liste des éléments, aperçu, inspecteur. En dessous, l'éditeur du `mode` choisi (téléphone) :
 * `plateau` tant que la préférence du compte n'est pas posée (phase « choix du format »).
 */
export function ExportEditor({
  mode = DEFAULT_EDITOR_MODE,
  ...editor
}: EditorProps & { mode?: EditorMode }) {
  const desktop = useScreen(DESKTOP_QUERY);
  const Mobile = editorFor(mode);
  return desktop ? <DesktopEditor {...editor} /> : <Mobile {...editor} />;
}
