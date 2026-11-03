"use client";
import { useCallback, useState } from "react";
import {
  editorChoiceFor,
  isPostponed,
  postpone,
  type EditorMode,
} from "@/lib/export-editor-mode";
import { useShell } from "../../shell";
import type { EditorProps } from "./editor-types";
import { DESKTOP_QUERY, ExportEditor, useScreen } from "./export-editor";
import { EditorModeDialog } from "./mode-dialog";

/** Le stockage de la séance du navigateur (absent côté serveur, ou bloqué) : `null` quand il manque. */
const sessionStore = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

/**
 * La porte de l'éditeur d'export : lit le rôle et la préférence du compte, puis décide (règle pure dans
 * `lib/export-editor-mode.ts`) :
 *  - une question est due (téléphone, testeur ou administrateur, jamais choisi, pas reportée) : d'abord la fenêtre
 *    de choix, puis l'éditeur choisi ;
 *  - sinon l'éditeur enregistré ; sinon le défaut du rôle (le pas à pas pour le récitateur, sans AUCUNE question) ;
 *  - le plateau reste le repli sûr si la préférence est inconnue.
 * Au bureau, jamais de question : `ExportEditor` montre la vue unifiée.
 * Le choix est enregistré sur le compte (préférences du serveur) : on le retrouve sur tout appareil.
 */
export function ExportEditorGate(props: EditorProps) {
  const { user, prefs, update } = useShell();
  const wide = useScreen(DESKTOP_QUERY);
  const [postponed, setPostponed] = useState(() => isPostponed(sessionStore()));
  const choice = editorChoiceFor({
    role: user.role,
    saved: prefs.editorMode,
    wide,
    postponed,
  });
  const choose = useCallback(
    (editorMode: EditorMode) => update({ editorMode }),
    [update],
  );
  const later = useCallback(() => {
    postpone(sessionStore());
    setPostponed(true);
  }, []);
  if (choice.ask) return <EditorModeDialog onChoose={choose} onLater={later} />;
  return <ExportEditor mode={choice.mode} {...props} />;
}
