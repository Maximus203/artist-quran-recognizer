"use client";
import type { BlockId } from "@/lib/export-video-model";
import { XIcon } from "../export-icons";
import type { ExportAction } from "./editor-types";
import { ElementNote } from "./text-sections";

/**
 * Le bas du plateau, sous la barre d'outils. Deux contenus se partagent UNE case de la grille :
 *  - rien de choisi : l'encart « déjà prête, exporter maintenant » ;
 *  - un élément choisi : ce qu'il faut savoir de lui (cadenas de l'arabe, attribution de la traduction).
 * Le contenu inactif reste dans la case, invisible et inatteignable (`inert`) : la case garde la hauteur du plus
 * haut des deux, donc l'aperçu ne descend plus de 60 px quand on touche un texte pour la première fois
 * (recette QA, m4) et les deux messages que l'interface doit toujours porter (I1, I2) ont leur place (M1).
 */
export function DockBelow({
  selected,
  attribution,
  exportAction,
}: {
  selected: BlockId | null;
  attribution?: string | null;
  exportAction: ExportAction;
}) {
  const ready = selected === null;
  return (
    <div className="xe-below" data-testid="editor-below">
      <div
        className="xe-ready"
        data-testid="editor-ready"
        data-off={ready ? undefined : ""}
        aria-hidden={ready ? undefined : true}
        inert={ready ? undefined : true}
      >
        <p>
          <b>Déjà prête</b>
          <span>
            Avec nos réglages conseillés. Touche un texte pour le modifier.
          </span>
        </p>
        <button
          type="button"
          className="btn btn--secondary xe-btn"
          data-testid="ready-export"
          disabled={exportAction.disabled}
          onClick={exportAction.onOpen}
        >
          <XIcon name="download" size={18} />
          Exporter maintenant
        </button>
      </div>
      <div
        className="xe-note"
        data-testid="editor-note"
        data-off={ready ? "" : undefined}
        aria-hidden={ready ? true : undefined}
      >
        {selected === null ? null : (
          <ElementNote id={selected} attribution={attribution} />
        )}
      </div>
    </div>
  );
}
