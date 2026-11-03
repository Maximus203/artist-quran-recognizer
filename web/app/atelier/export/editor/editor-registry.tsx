import { DEFAULT_EDITOR_MODE } from "./editor-types";
import type { EditorComponent, EditorMode } from "./editor-types";
import { PlateauEditor } from "./plateau-mobile";
import { TableEditor } from "./table-editor";

/**
 * LE REGISTRE des éditeurs de la vue téléphone : une ligne par éditeur. Les phases suivantes ajoutent la
 * leur ICI (une ligne chacune, rien d'autre à toucher) :
 *
 *   table: TableEditor,   // phase « table de montage »
 *   pas: PasEditor,       // phase « pas à pas »
 *
 * Un mode sans éditeur enregistré retombe sur l'éditeur par défaut (le plateau) : le choix du format peut
 * donc être branché avant que les trois éditeurs existent, sans jamais montrer un écran vide.
 * La vue bureau n'est PAS dans ce registre : elle est unique et sert tous les modes.
 */
export const EDITORS: Partial<Record<EditorMode, EditorComponent>> = {
  plateau: PlateauEditor,
  table: TableEditor,
};

/** L'éditeur à montrer pour un mode (le plateau si ce mode n'a pas encore le sien). */
export function editorFor(mode: EditorMode): EditorComponent {
  return EDITORS[mode] ?? (EDITORS[DEFAULT_EDITOR_MODE] as EditorComponent);
}
