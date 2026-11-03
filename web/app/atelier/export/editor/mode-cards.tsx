"use client";
import { useState } from "react";
import { EDITOR_MODES, type EditorMode } from "@/lib/export-editor-mode";
import { Icon } from "../../icons";
import { ModeDemo } from "./mode-demo";
import { modeInfo } from "./mode-info";

/**
 * Les trois formats côte à côte, avec leur explication et leur animation : UN composant pour la fenêtre de la
 * première ouverture ET pour la section des paramètres (mêmes mots, mêmes images, rien de recopié).
 * Un seul geste choisit : le bouton de la carte. Le format actuel (paramètres) est marqué et n'a plus de bouton.
 */
export function EditorModeCards({
  current,
  currentIsDefault = false,
  onChoose,
}: {
  /** Le format en place ; `null` = jamais choisi (première question : rien n'est coché d'avance). */
  current: EditorMode | null;
  /** Le format en place vient du rôle, pas d'un choix de la personne. */
  currentIsDefault?: boolean;
  onChoose: (mode: EditorMode) => void;
}) {
  const [paused, setPaused] = useState(false);
  return (
    <div className="mcards" data-paused={paused}>
      <div className="mcards__bar">
        <button
          type="button"
          className="btn btn--ghost btn--sm mdemo-pause"
          aria-pressed={paused}
          data-testid="mode-pause"
          onClick={() => setPaused((value) => !value)}
        >
          <Icon name={paused ? "play" : "pause"} />
          {paused
            ? "Reprendre les animations"
            : "Mettre les animations en pause"}
        </button>
      </div>
      <ul className="mcards__list">
        {EDITOR_MODES.map((mode) => {
          const info = modeInfo(mode);
          const isCurrent = current === mode;
          return (
            <li
              key={mode}
              className="mcard"
              data-mode={mode}
              data-testid={`mode-card-${mode}`}
              data-current={isCurrent ? "true" : undefined}
            >
              <ModeDemo mode={mode} />
              <div className="mcard__body">
                <h3 className="mcard__name">
                  {info.name}
                  {isCurrent ? (
                    <span className="badge badge--outline mcard__badge">
                      <Icon name="check" />
                      {currentIsDefault ? "Actuel · par défaut" : "Actuel"}
                    </span>
                  ) : null}
                </h3>
                <p className="mcard__quote">{info.quote}</p>
                <p className="mcard__what">{info.what}</p>
                <p className="mcard__who">{info.who}</p>
                {isCurrent ? (
                  <p className="mcard__now" data-testid={`mode-now-${mode}`}>
                    <Icon name="check" />
                    Format actuel
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn btn--primary btn--lg mcard__pick"
                    data-testid={`mode-pick-${mode}`}
                    onClick={() => onChoose(mode)}
                  >
                    Choisir le format {info.name}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
