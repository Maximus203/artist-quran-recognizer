"use client";
import { useEffect, useRef } from "react";
import {
  accentCss,
  accentSolidCss,
  DEFAULT_ACCENT,
  SOFT_ACCENTS,
} from "@/lib/export-video-accent";
import type { AccentColor } from "@/lib/export-video-prefs";

/**
 * Sélecteur de couleur d'accent de la vidéo : couleurs douces d'un clic, ou réglage fin sur quatre
 * niveaux (teinte, intensité, luminosité, opacité) avec un échantillon sur fond sombre. Le choix
 * s'applique en direct à l'aperçu ; « Automatique » revient à la couleur principale du fond.
 */
export function AccentDialog({
  open,
  value,
  onChange,
  onClose,
}: {
  open: boolean;
  /** Couleur choisie ; null = automatique. */
  value: AccentColor | null;
  onChange: (next: AccentColor | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const color = value ?? DEFAULT_ACCENT;
  const set = (patch: Partial<AccentColor>) => onChange({ ...color, ...patch });
  const hueTrack = `linear-gradient(90deg, ${Array.from({ length: 13 }, (_, i) => `hsl(${i * 30}, ${color.s}%, ${color.l}%)`).join(", ")})`;
  const satTrack = `linear-gradient(90deg, hsl(${color.h}, 0%, ${color.l}%), hsl(${color.h}, 100%, ${color.l}%))`;
  const lightTrack = `linear-gradient(90deg, hsl(${color.h}, ${color.s}%, 20%), hsl(${color.h}, ${color.s}%, 55%), hsl(${color.h}, ${color.s}%, 90%))`;
  const alphaTrack = `linear-gradient(90deg, transparent, ${accentSolidCss(color)})`;

  const sliders: {
    id: string;
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    track: string;
    unit: string;
    apply: (n: number) => Partial<AccentColor>;
  }[] = [
    {
      id: "h",
      label: "Teinte",
      min: 0,
      max: 360,
      step: 1,
      value: color.h,
      track: hueTrack,
      unit: "°",
      apply: (n) => ({ h: n }),
    },
    {
      id: "s",
      label: "Intensité",
      min: 0,
      max: 100,
      step: 1,
      value: color.s,
      track: satTrack,
      unit: " %",
      apply: (n) => ({ s: n }),
    },
    {
      id: "l",
      label: "Luminosité",
      min: 20,
      max: 90,
      step: 1,
      value: color.l,
      track: lightTrack,
      unit: " %",
      apply: (n) => ({ l: n }),
    },
    {
      id: "a",
      label: "Opacité",
      min: 30,
      max: 100,
      step: 1,
      value: Math.round(color.a * 100),
      track: alphaTrack,
      unit: " %",
      apply: (n) => ({ a: n / 100 }),
    },
  ];

  return (
    <dialog
      ref={ref}
      className="ex-accent"
      data-testid="accent-dialog"
      aria-labelledby="ex-accent-h"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="ex-accent-body">
        <h3 id="ex-accent-h">Couleur d&rsquo;accent</h3>
        <p className="ex-micro">
          Elle colore le mot récité et la référence du verset. Par défaut, elle
          suit la couleur principale du fond.
        </p>

        <button
          type="button"
          className={`ex-accent-auto${value === null ? " is-active" : ""}`}
          data-testid="accent-auto"
          onClick={() => onChange(null)}
        >
          Automatique <small>couleur principale du fond</small>
        </button>

        <div
          className="ex-accent-swatches"
          role="group"
          aria-label="Couleurs douces"
        >
          {SOFT_ACCENTS.map((soft) => (
            <button
              key={soft.label}
              type="button"
              className="ex-accent-swatch"
              style={{ background: accentSolidCss(soft) }}
              aria-label={soft.label}
              title={soft.label}
              data-testid={`accent-soft-${soft.label}`}
              aria-pressed={
                value !== null &&
                Math.round(value.h) === soft.h &&
                Math.round(value.s) === soft.s &&
                Math.round(value.l) === soft.l
              }
              onClick={() =>
                onChange({ h: soft.h, s: soft.s, l: soft.l, a: 1 })
              }
            />
          ))}
        </div>

        <div className="ex-accent-sample" aria-hidden="true">
          <span>وَٱلنَّهَارِ</span>
          <b style={{ color: accentCss(color) }}>إِذَا جَلَّىٰهَا</b>
        </div>

        <div className="ex-accent-sliders">
          {sliders.map((slider) => (
            <label key={slider.id} className="ex-accent-slider">
              <span>
                {slider.label}
                <b className="mono">
                  {slider.value}
                  {slider.unit}
                </b>
              </span>
              <input
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={slider.value}
                data-testid={`accent-${slider.id}`}
                style={{ background: slider.track }}
                onChange={(event) =>
                  set(slider.apply(Number(event.target.value)))
                }
              />
            </label>
          ))}
        </div>

        <div className="ex-accent-foot">
          <button
            type="button"
            className="btn btn--primary"
            data-testid="accent-close"
            onClick={onClose}
          >
            Terminé
          </button>
        </div>
      </div>
    </dialog>
  );
}
