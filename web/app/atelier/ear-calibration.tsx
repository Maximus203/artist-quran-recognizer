"use client";
import {
  AUDIO_OFFSET,
  clampAudioOffset,
  formatAudioOffset,
  stepAudioOffset,
} from "@/lib/audio-offset";
import { Icon } from "./icons";

/** Le calage à l'oreille tel que la carte du passage l'affiche (l'état vit dans `LivePassage`). */
export type CalibrationView = {
  /** Un verset est affiché : on peut en lire un bout en boucle. */
  available: boolean;
  open: boolean;
  /** Décalage audio courant (ms), préférence du compte. */
  offsetMs: number;
  /** Le passage est en train de tourner en boucle. */
  playing: boolean;
  onOpen: () => void;
  onClose: () => void;
  onOffset: (ms: number) => void;
  onToggleLoop: () => void;
};

/** Le bouton qui ouvre le calage ; masqué quand aucun verset n'est affiché. */
export function CalibrationButton({ view }: { view: CalibrationView }) {
  if (!view.available && !view.open) return null;
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm"
      data-testid="calibrate-open"
      aria-expanded={view.open}
      aria-controls="calibrate-panel"
      onClick={view.open ? view.onClose : view.onOpen}
    >
      <Icon name="sliders" />
      Caler à l’oreille
    </button>
  );
}

/**
 * Calage à l'oreille : on lit en boucle le début du passage, et le curseur déplace le surlignage en
 * direct. Le décalage retarde seulement l'AFFICHAGE : l'audio, l'onde et les temps du moteur ne bougent pas.
 */
export function CalibrationPanel({ view }: { view: CalibrationView }) {
  if (!view.open) return null;
  const { offsetMs } = view;
  const percent =
    ((offsetMs - AUDIO_OFFSET.min) / (AUDIO_OFFSET.max - AUDIO_OFFSET.min)) *
    100;
  return (
    <div
      id="calibrate-panel"
      className="calibrate"
      role="group"
      aria-labelledby="calibrate-title"
      data-testid="calibrate-panel"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          view.onClose();
        }
      }}
    >
      <p id="calibrate-title" className="calibrate-title">
        Caler à l’oreille
      </p>
      <p className="calibrate-help">
        Écoute le passage en boucle. Si le mot surligné devance la voix, pousse
        vers <b>+</b> ; s’il la suit, vers <b>−</b>. Seul le surlignage est
        décalé, jamais l’audio.
      </p>
      <div className="calibrate-line">
        <button
          type="button"
          className="btn btn--secondary btn--icon"
          data-testid="calibrate-minus"
          aria-label="Avancer le surlignage de 10 millisecondes"
          disabled={offsetMs <= AUDIO_OFFSET.min}
          onClick={() => view.onOffset(stepAudioOffset(offsetMs, -1))}
        >
          −
        </button>
        <input
          type="range"
          data-testid="calibrate-range"
          min={AUDIO_OFFSET.min}
          max={AUDIO_OFFSET.max}
          step={AUDIO_OFFSET.step}
          value={offsetMs}
          aria-labelledby="calibrate-title"
          aria-valuetext={formatAudioOffset(offsetMs)}
          style={{ "--p": `${percent}%` } as React.CSSProperties}
          onChange={(event) =>
            view.onOffset(clampAudioOffset(Number(event.target.value)))
          }
        />
        <button
          type="button"
          className="btn btn--secondary btn--icon"
          data-testid="calibrate-plus"
          aria-label="Retarder le surlignage de 10 millisecondes"
          disabled={offsetMs >= AUDIO_OFFSET.max}
          onClick={() => view.onOffset(stepAudioOffset(offsetMs, 1))}
        >
          +
        </button>
        <output
          className="calibrate-value"
          data-testid="calibrate-value"
          aria-live="off"
        >
          {formatAudioOffset(offsetMs)}
        </output>
      </div>
      <div className="calibrate-actions">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          data-testid="calibrate-loop"
          onClick={view.onToggleLoop}
        >
          <Icon name={view.playing ? "pause" : "play"} fill />
          {view.playing ? "Arrêter la boucle" : "Écouter en boucle"}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          data-testid="calibrate-zero"
          disabled={offsetMs === 0}
          onClick={() => view.onOffset(0)}
        >
          Remettre à 0
        </button>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          data-testid="calibrate-done"
          onClick={view.onClose}
        >
          Terminé
        </button>
      </div>
    </div>
  );
}
