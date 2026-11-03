"use client";
import { useEffect, useId, useRef } from "react";
import type { EditorMode } from "@/lib/export-editor-mode";
import { useFocusTrap } from "../../hooks";
import { EditorModeCards } from "./mode-cards";

/**
 * La question de la première ouverture : « Comment veux-tu régler ta vidéo ? ». Une vraie fenêtre modale : le focus
 * y reste (Tab ne s'en échappe pas), Échap la ferme, le focus arrive sur son titre. Fermer par Échap, c'est
 * « choisir plus tard » : on ne force jamais un choix. Un seul geste valide : le bouton d'une carte.
 */
export function EditorModeDialog({
  onChoose,
  onLater,
}: {
  onChoose: (mode: EditorMode) => void;
  onLater: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  useFocusTrap(box, true, onLater);
  // Le piège de focus donne d'abord le focus au premier bouton ; le titre passe devant : on entend la question.
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  return (
    <div className="mdlg-back" data-testid="mode-dialog-back">
      <div
        className="mdlg"
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        aria-describedby={`${id}-p`}
        data-testid="mode-dialog"
      >
        <header className="mdlg__head">
          <h2 id={`${id}-h`} ref={heading} tabIndex={-1}>
            Comment veux-tu régler ta vidéo ?
          </h2>
          <p id={`${id}-p`}>
            Trois façons de faire la même vidéo. Prends celle qui te ressemble :
            tu pourras en changer quand tu veux, dans Compte, Préférences.
          </p>
        </header>
        <div className="mdlg__body">
          <EditorModeCards current={null} onChoose={onChoose} />
        </div>
        <footer className="mdlg__foot">
          <button
            type="button"
            className="btn btn--ghost mdlg__later"
            data-testid="mode-later"
            onClick={onLater}
          >
            Choisir plus tard
          </button>
          <p className="hint hint--xs">
            Cette fois, tu auras le plateau. La question reviendra à ta
            prochaine visite.
          </p>
        </footer>
      </div>
    </div>
  );
}
