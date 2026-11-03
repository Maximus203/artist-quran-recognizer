"use client";
import { XIcon } from "../export-icons";
import type { EditorProps } from "./editor-types";

/**
 * La barre du haut, commune à tous les éditeurs : retour, nom de la session et l'UNIQUE bouton « Exporter »,
 * qui ouvre la fenêtre-résumé existante (la même au téléphone et au bureau).
 */
export function EditorTopBar({
  title,
  subtitle,
  onLeave,
  exportAction,
}: Pick<EditorProps, "title" | "subtitle" | "onLeave" | "exportAction">) {
  return (
    <header className="xe-top" data-testid="editor-top">
      {onLeave ? (
        <button
          type="button"
          className="xe-back"
          aria-label="Retour"
          data-testid="editor-back"
          onClick={onLeave}
        >
          <XIcon name="chev-l" size={24} />
        </button>
      ) : null}
      <div className="xe-top-title">
        <h1>
          <span className="sr">Exporter la vidéo : </span>
          {title}
        </h1>
        <p>{exportAction.status ?? subtitle}</p>
      </div>
      <button
        type="button"
        className="btn btn--accent xe-export"
        data-testid="video-export"
        disabled={exportAction.disabled}
        aria-haspopup="dialog"
        onClick={exportAction.onOpen}
      >
        <XIcon name="download" size={20} />
        <span>{exportAction.label}</span>
      </button>
    </header>
  );
}
