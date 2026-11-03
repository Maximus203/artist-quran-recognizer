"use client";
import { useState } from "react";
import {
  canChooseEditorMode,
  effectiveEditorMode,
  shouldAskEditorMode,
  type EditorMode,
} from "@/lib/export-editor-mode";
import { EditorModeCards } from "./export/editor/mode-cards";
import { modeInfo } from "./export/editor/mode-info";
import { useShell } from "./shell";

/**
 * « Éditeur d'export (téléphone) » dans les préférences du compte : les trois formats avec les mêmes explications
 * et les mêmes animations que la fenêtre de la première ouverture, l'actuel marqué, un seul geste pour changer.
 * Le choix part sur le compte tout de suite ; il prend effet à la prochaine ouverture de l'export.
 */
export function EditorModeSetting() {
  const { prefs, update, user } = useShell();
  const [announce, setAnnounce] = useState("");
  if (!canChooseEditorMode(user.role)) return null;
  // Jamais choisi : un testeur sera interrogé à sa première ouverture (rien n'est marqué) ; un récitateur
  // a son format par défaut, qu'on lui montre comme tel.
  const hasDefault = !shouldAskEditorMode({
    role: user.role,
    saved: prefs.editorMode,
    wide: false,
  });
  const current: EditorMode | null =
    prefs.editorMode ??
    (hasDefault ? effectiveEditorMode({ role: user.role, saved: null }) : null);
  return (
    <div
      className="card setgroup"
      aria-labelledby="g-edit"
      data-testid="pref-editor-mode"
    >
      <header>
        <h2 id="g-edit">Éditeur d’export (téléphone)</h2>
        <p>
          Comment tu règles ta vidéo sur ton téléphone. Au bureau, l’éditeur est
          le même pour tout le monde. Ton choix prend effet à la prochaine
          ouverture de l’export.
          {current === null
            ? " Tu n’as pas encore choisi : on te le demandera à ta première ouverture sur téléphone, ou choisis-le ici."
            : ""}
        </p>
      </header>
      <EditorModeCards
        current={current}
        currentIsDefault={prefs.editorMode === null}
        onChoose={(editorMode) => {
          update({ editorMode });
          setAnnounce(
            `Format ${modeInfo(editorMode).name} enregistré. Il s’ouvrira à ta prochaine ouverture de l’export.`,
          );
        }}
      />
      <div className="sr" role="status" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
