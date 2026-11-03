"use client";
import { useState } from "react";
import { BLOCK_LABEL } from "@/lib/export-video-edit-text";
import type { BlockId } from "@/lib/export-video-model";
import { XIcon } from "../export-icons";
import { EditableStage } from "./editable-stage";
import { EditorTopBar } from "./editor-chrome";
import { BLOCK_ICON, EIcon } from "./editor-icons";
import type { EditorProps } from "./editor-types";
import { PassagesDialog } from "./frame-sections";
import { ElementSections, FrameSections } from "./inspector-sections";
import { useEditorController } from "./use-editor-controller";

/**
 * LA VUE BUREAU (1024 px et plus), unique et la même pour tous les rôles : la liste des éléments à gauche,
 * l'aperçu au centre, l'inspecteur à droite. L'inspecteur affiche les MÊMES sections que les feuilles du
 * téléphone (`ElementSections`, `FrameSections`), l'une sous l'autre au lieu d'une à la fois. L'aperçu est
 * manipulable à la souris et au clavier ; le bouton « Exporter » est celui de la barre du haut.
 */

const ORDER: readonly BlockId[] = ["arabic", "translation", "wave", "ref"];

export function DesktopEditor(editor: EditorProps) {
  const controller = useEditorController({
    prefs: editor.prefs,
    patch: editor.patch,
    sourceSize: editor.preview.sourceSize,
  });
  const [passagesOpen, setPassagesOpen] = useState(false);
  const { selected } = controller;

  const pick = (id: BlockId) => {
    if (!controller.visible[id]) controller.setVisible(id, true);
    controller.select(selected === id ? null : id);
  };

  return (
    <div className="xe-desk" data-testid="editor-desktop">
      <EditorTopBar
        title={editor.title}
        subtitle={editor.subtitle}
        onLeave={editor.onLeave}
        exportAction={editor.exportAction}
      />
      <div className="xe-work">
        <nav className="xe-rail" aria-label="Éléments de la vidéo">
          <h2>Éléments</h2>
          <p className="xe-hint">Clique un élément dans l’aperçu ou ici.</p>
          <ul>
            {ORDER.map((id) => {
              const shown = controller.visible[id];
              const hideable = controller.canHide(id);
              return (
                <li key={id} data-off={!shown || undefined}>
                  <button
                    type="button"
                    className="xe-row"
                    aria-pressed={selected === id}
                    data-testid={`row-${id}`}
                    onClick={() => pick(id)}
                  >
                    <EIcon name={BLOCK_ICON[id]} size={22} />
                    <b>{BLOCK_LABEL[id]}</b>
                    {id === "arabic" ? (
                      <span className="xe-row-lock" title="Jamais modifiable">
                        <XIcon name="lock" size={14} />
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="xe-eye"
                    disabled={shown && !hideable}
                    aria-label={`${shown ? "Masquer" : "Afficher"} : ${BLOCK_LABEL[id].toLowerCase()}`}
                    title={
                      shown && !hideable
                        ? "Une des deux écritures reste affichée."
                        : undefined
                    }
                    data-testid={`eye-${id}`}
                    onClick={() => controller.setVisible(id, !shown)}
                  >
                    <EIcon name={shown ? "eye" : "eye-off"} size={20} />
                  </button>
                </li>
              );
            })}
            <li>
              <button
                type="button"
                className="xe-row"
                aria-pressed={selected === null}
                data-testid="row-frame"
                onClick={() => controller.select(null)}
              >
                <EIcon name="layers" size={22} />
                <b>Cadre, fond, passages</b>
              </button>
            </li>
          </ul>
          <p className="xe-keys">
            Clavier, sur un élément choisi :<br />
            <kbd>←</kbd>
            <kbd>↑</kbd>
            <kbd>→</kbd>
            <kbd>↓</kbd> déplacer · <kbd>Maj</kbd> ×5
            <br />
            <kbd>Ctrl</kbd> + flèches : changer la zone
            <br />
            <kbd>+</kbd> <kbd>−</kbd> taille du texte · <kbd>Échap</kbd>{" "}
            désélectionner
          </p>
        </nav>

        <section className="xe-center" aria-label="Aperçu de la vidéo">
          <EditableStage
            sessionId={editor.sessionId}
            source={editor.preview}
            controller={controller}
          />
        </section>

        <aside
          className="xe-insp"
          aria-label={
            selected
              ? `Réglages : ${BLOCK_LABEL[selected].toLowerCase()}`
              : "Réglages du cadre"
          }
          data-testid="editor-inspector"
        >
          {selected ? (
            <ElementSections
              controller={controller}
              id={selected}
              attribution={editor.preview.attribution}
            />
          ) : (
            <>
              <header className="xe-eh">
                <span className="xe-eh-icon" aria-hidden="true">
                  <EIcon name="layers" size={22} />
                </span>
                <div className="xe-eh-text">
                  <h2>Cadre et fond</h2>
                  <p>Ce qui concerne toute la vidéo</p>
                </div>
              </header>
              <FrameSections
                editor={editor}
                onOpenPassages={() => setPassagesOpen(true)}
              />
            </>
          )}
        </aside>
      </div>
      <PassagesDialog
        open={passagesOpen}
        onClose={() => setPassagesOpen(false)}
      >
        {editor.passages.content}
      </PassagesDialog>
    </div>
  );
}
