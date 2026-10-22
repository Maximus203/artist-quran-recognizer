"use client";
import { useRef, useState } from "react";
import { Icon } from "./icons";
import { useDismiss } from "./session-bits";

type Props = {
  count: number;
  /** Nombre de sessions sélectionnées dont l'utilisateur n'est pas propriétaire. */
  foreign: number;
  /** Toutes les sélectionnées sont déjà en favori : le geste devient « Retirer des favoris ». */
  allFavorite: boolean;
  archivedScope: boolean;
  /** Suppression possible : dans Archivées, sur ses propres sessions. */
  canDelete: boolean;
  onFavorite: () => void;
  onArchive: () => void;
  onVisibility: (visibility: "global" | "private") => void;
  onDelete: () => void;
  onCancel: () => void;
};

/** Barre d'actions collante au bas de l'écran quand des sessions sont sélectionnées. */
export function SelectionBar(props: Props) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const popWrap = useRef<HTMLSpanElement>(null);
  const scopeButton = useRef<HTMLButtonElement>(null);
  useDismiss(
    scopeOpen,
    () => {
      setScopeOpen(false);
      setConfirmGlobal(false);
    },
    popWrap,
    scopeButton,
  );
  return (
    <div
      className="selbar"
      role="region"
      aria-label="Actions sur la sélection"
      data-testid="selection-bar"
    >
      <span className="cnt" aria-live="polite">
        {props.count} sélectionnée{props.count > 1 ? "s" : ""}
      </span>
      {confirmDelete ? (
        <>
          <span className="note-s" style={{ flexBasis: "auto" }}>
            L’audio, l’analyse et les signalements seront effacés. Cette action
            est irréversible.
          </span>
          <button
            type="button"
            className="btn btn--danger btn--sm"
            data-testid="confirm-bulk-delete"
            onClick={() => {
              setConfirmDelete(false);
              props.onDelete();
            }}
          >
            Supprimer {props.count}
          </button>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => setConfirmDelete(false)}
          >
            Annuler
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            data-testid="bulk-favorite"
            onClick={props.onFavorite}
          >
            <Icon name="star" />
            <span className="txt">
              {props.allFavorite ? "Retirer des favoris" : "Favoris"}
            </span>
            <span className="sr">
              {props.allFavorite ? "" : " : ajouter la sélection aux favoris"}
            </span>
          </button>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            data-testid="bulk-archive"
            onClick={props.onArchive}
          >
            <Icon name={props.archivedScope ? "undo" : "archive"} />
            <span className="txt">
              {props.archivedScope ? "Restaurer" : "Archiver"}
            </span>
          </button>
          <span className="pop-wrap" ref={popWrap}>
            <button
              ref={scopeButton}
              type="button"
              className="btn btn--secondary btn--sm"
              data-testid="bulk-scope"
              aria-haspopup="menu"
              aria-expanded={scopeOpen}
              onClick={() => setScopeOpen((v) => !v)}
            >
              <Icon name="globe" />
              <span className="txt">Portée</span>
              <Icon name="chevron-d" />
            </button>
            {scopeOpen ? (
              <div
                className="rowmenu"
                role="menu"
                style={{
                  bottom: "calc(100% + 8px)",
                  top: "auto",
                  right: "auto",
                  left: 0,
                }}
              >
                {confirmGlobal ? (
                  <div style={{ padding: 8, display: "grid", gap: 8 }}>
                    <p className="banner">
                      <small>
                        Tout le monde pourra écouter ces audios et voir leurs
                        résultats. Tu pourras les repasser en privé.
                      </small>
                    </p>
                    <div className="btnrow">
                      <button
                        type="button"
                        className="btn btn--primary btn--sm"
                        data-testid="bulk-make-global"
                        onClick={() => {
                          setScopeOpen(false);
                          setConfirmGlobal(false);
                          props.onVisibility("global");
                        }}
                      >
                        Rendre global
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setConfirmGlobal(false)}
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      data-testid="bulk-make-private"
                      onClick={() => {
                        setScopeOpen(false);
                        props.onVisibility("private");
                      }}
                    >
                      <Icon name="lock" />
                      Rendre privé
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => setConfirmGlobal(true)}
                    >
                      <Icon name="globe" />
                      Rendre global…
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </span>
          {props.canDelete ? (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              data-testid="bulk-delete"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon name="trash" />
              <span className="txt">Supprimer…</span>
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--ghost btn--sm keep-txt"
            onClick={props.onCancel}
          >
            <span className="txt">Annuler</span>
            <span className="sr"> la sélection</span>
            <Icon name="x" />
          </button>
        </>
      )}
      {props.foreign > 0 ? (
        <span className="note-s" data-testid="foreign-note">
          {props.foreign} session
          {props.foreign > 1 ? "s appartiennent" : " appartient"} à d’autres
          testeurs : leur portée ne sera pas modifiée.
        </span>
      ) : null}
    </div>
  );
}
