"use client";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { repeatDelay, sizePercent } from "@/lib/export-video-edit";
import { SIZE_LIMITS } from "@/lib/export-video-model";
import { rovingKeys } from "../export-ui";

/**
 * Les petits contrôles de l'éditeur de la vidéo d'export, partagés par la feuille du téléphone, l'inspecteur
 * du bureau et les deux autres éditeurs : un bouton qui répète à l'appui long, le pas − / + avec la valeur
 * toujours visible, des tuiles à choix unique, une rangée de couleurs, un curseur. Toutes les cibles font
 * 44 px sur le bouton lui-même.
 */

// ── appui long ──────────────────────────────────────────────────────────────

export type HoldHandlers = {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onKeyUp: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onBlur: () => void;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
};

/**
 * Un appui fait l'action tout de suite ; tenu, elle se répète (une pause, puis de plus en plus vite, voir
 * `repeatDelay`). L'action renvoie `false` quand elle ne change plus rien (une borne est atteinte) : la
 * répétition s'arrête là. Le relâcher est écouté sur la fenêtre (le bouton peut se désactiver sous le doigt
 * en atteignant la borne et ne plus rien recevoir) ; le tout est retiré au démontage.
 * Au clavier, Entrée et Espace font l'action une fois (le navigateur répète tout seul s'ils sont tenus).
 */
export function useHoldRepeat(action: () => boolean | void): HoldHandlers {
  const latest = useRef(action);
  latest.current = action;
  const timer = useRef<number | null>(null);
  const release = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    release.current?.();
    release.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const schedule = useCallback(
    (count: number) => {
      timer.current = window.setTimeout(() => {
        if (latest.current() === false) return stop();
        schedule(count + 1);
      }, repeatDelay(count));
    },
    [stop],
  );

  return {
    onPointerDown(event) {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      stop();
      if (latest.current() === false) return;
      const end = () => stop();
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
      release.current = () => {
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
      };
      schedule(0);
    },
    // Un clic à la souris ou au doigt est déjà passé par onPointerDown ; au clavier `detail` vaut 0.
    onClick(event) {
      if (event.detail === 0) latest.current();
    },
    onKeyUp() {},
    onBlur: stop,
    onContextMenu: (event) => event.preventDefault(),
  };
}

// ── pas − / + ───────────────────────────────────────────────────────────────

/**
 * « [ − ] 100 % [ + ] » : la taille d'un texte, ou la hauteur de l'onde. La valeur est toujours visible
 * (et annoncée quand elle change) ; − et + répètent à l'appui long ; le cadre du milieu remet à 100 %.
 */
export function SizeStepper({
  label,
  value,
  sub,
  onStep,
  onReset,
  atMin,
  atMax,
  minusLabel,
  plusLabel,
  testId,
}: {
  label: string;
  /** Le texte affiché au milieu (« 100 % »). */
  value: string;
  /** La précision sous la valeur (« de la taille de départ »). */
  sub: string;
  /** Un pas ; renvoie `false` quand la borne est atteinte. */
  onStep: (direction: 1 | -1) => boolean | void;
  onReset?: () => void;
  atMin: boolean;
  atMax: boolean;
  minusLabel: string;
  plusLabel: string;
  testId: string;
}) {
  const minus = useHoldRepeat(() => (atMin ? false : onStep(-1)));
  const plus = useHoldRepeat(() => (atMax ? false : onStep(1)));
  return (
    <div className="xe-step" role="group" aria-label={label}>
      <button
        type="button"
        className="xe-step-btn"
        aria-label={minusLabel}
        disabled={atMin}
        data-testid={`${testId}-down`}
        {...minus}
      >
        <span aria-hidden="true">−</span>
      </button>
      {onReset ? (
        <button
          type="button"
          className="xe-step-val"
          aria-label={`${label} : ${value}. Remettre à 100 %`}
          data-testid={`${testId}-value`}
          onClick={onReset}
        >
          <b aria-live="polite">{value}</b>
          <small>{sub}</small>
        </button>
      ) : (
        <div className="xe-step-val" data-testid={`${testId}-value`}>
          <b aria-live="polite">{value}</b>
          <small>{sub}</small>
        </div>
      )}
      <button
        type="button"
        className="xe-step-btn"
        aria-label={plusLabel}
        disabled={atMax}
        data-testid={`${testId}-up`}
        {...plus}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}

/** Les bornes de la taille d'un texte, pour `SizeStepper`. */
export const sizeBounds = (size: number) => ({
  atMin: size <= SIZE_LIMITS.min + 1e-9,
  atMax: size >= SIZE_LIMITS.max - 1e-9,
  label: `${sizePercent(size)} %`,
});

// ── tuiles à choix unique ───────────────────────────────────────────────────

export type TileOption<T extends string> = {
  value: T;
  label: string;
  hint?: string;
  /** L'échantillon dessiné dans la tuile. */
  visual: ReactNode;
  testId?: string;
};

/**
 * Des tuiles à choix unique (un seul coché, flèches pour passer de l'une à l'autre) : le genre de fond
 * d'un texte, le format de la vidéo. Chaque tuile mesure au moins 44 px de haut, sur le bouton lui-même.
 */
export function Tiles<T extends string>({
  label,
  options,
  value,
  onPick,
  columns,
  className,
}: {
  label: string;
  options: readonly TileOption<T>[];
  value: T;
  onPick: (value: T) => void;
  columns?: number;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      className={`xe-tiles${className ? ` ${className}` : ""}`}
      role="radiogroup"
      aria-label={label}
      data-count={columns ?? options.length}
      onKeyDown={rovingKeys}
      id={id}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          className="xe-tile"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          data-testid={option.testId}
          onClick={() => onPick(option.value)}
        >
          <span className="xe-tile-visual" aria-hidden="true">
            {option.visual}
          </span>
          <b>{option.label}</b>
          {option.hint ? <small>{option.hint}</small> : null}
        </button>
      ))}
    </div>
  );
}

// ── couleur ─────────────────────────────────────────────────────────────────

/**
 * Six couleurs d'un clic, et une septième libre (le sélecteur de couleur du navigateur). La couleur
 * choisie est cochée ; une couleur libre qui n'est pas dans les six l'est aussi (case « Autre »).
 */
export function ColorField({
  label,
  value,
  swatches,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  swatches: readonly { value: string; label: string }[];
  onChange: (color: string) => void;
  testId: string;
}) {
  const known = swatches.some((s) => s.value === value.toLowerCase());
  return (
    <div className="xe-colors" role="radiogroup" aria-label={label}>
      {swatches.map((swatch) => (
        <button
          key={swatch.value}
          type="button"
          role="radio"
          className="xe-swatch"
          aria-checked={swatch.value === value.toLowerCase()}
          aria-label={swatch.label}
          title={swatch.label}
          data-testid={`${testId}-${swatch.value.slice(1)}`}
          onClick={() => onChange(swatch.value)}
        >
          <i style={{ background: swatch.value }} />
        </button>
      ))}
      <label
        className="xe-swatch xe-swatch--free"
        data-checked={!known || undefined}
        title="Une autre couleur"
      >
        <i style={{ background: value }} aria-hidden="true" />
        <input
          type="color"
          value={value}
          aria-label={`${label} : une autre couleur`}
          data-testid={`${testId}-libre`}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
    </div>
  );
}

// ── curseur ─────────────────────────────────────────────────────────────────

export function RangeField({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
  testId,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  testId: string;
}) {
  return (
    <label className="xe-range">
      <span>
        {label} <b className="mono">{display}</b>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        data-testid={testId}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}
