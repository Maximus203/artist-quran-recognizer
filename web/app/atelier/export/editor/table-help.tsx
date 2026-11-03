"use client";

/**
 * L'aide du premier affichage de la table de montage : trois phrases pour les trois mots qu'un monteur
 * connaît et que personne d'autre ne connaît — chronologie, piste, tête de lecture. Un texte à lire : il reste
 * jusqu'à « Compris », et le bouton « ? » de la chronologie le rouvre.
 */
export function TableHelp({ onDismiss }: { onDismiss: () => void }) {
  return (
    <aside
      className="xt-help"
      aria-label="Comment lire la chronologie"
      data-testid="table-help"
    >
      <h2>Voici ta vidéo, minute par minute</h2>
      <ul>
        <li>
          La <b>chronologie</b> montre la récitation de gauche à droite, du
          début à la fin.
        </li>
        <li>
          Chaque ligne est une <b>piste</b> : les passages (versets), le son
          (l’onde) et le fond.
        </li>
        <li>
          La <b>tête de lecture</b> est la ligne verticale : elle montre
          l’instant affiché dans l’aperçu. Glisse-la sur l’onde, ou utilise les
          boutons ◀ ▶.
        </li>
      </ul>
      <button
        type="button"
        className="btn btn--primary xe-btn"
        data-testid="table-help-ok"
        onClick={onDismiss}
      >
        Compris
      </button>
    </aside>
  );
}
