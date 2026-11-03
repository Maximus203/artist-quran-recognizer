"use client";
import type { KeyboardEvent, ReactNode } from "react";

/**
 * Briques de l'écran d'export (direction « Le rouleau et les signets ») : contrôle segmenté (radiogroup
 * aux flèches), interrupteur, pas-à-pas.
 */

/** Flèches dans un radiogroup : passe au bouton voisin, le coche et le met au point. */
export function rovingKeys(event: KeyboardEvent<HTMLElement>): void {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
    return;
  const host = event.currentTarget;
  const radios = Array.from(
    host.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'),
  );
  const i = radios.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  event.preventDefault();
  const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
  const next = radios[(i + (forward ? 1 : radios.length - 1)) % radios.length];
  next.focus();
  next.click();
}

export function Segmented<T extends string | number>({
  label,
  items,
  value,
  onPick,
  testId,
  full = false,
}: {
  label: string;
  items: readonly { value: T; label: ReactNode; id?: string }[];
  value: T;
  onPick: (value: T) => void;
  testId?: string;
  full?: boolean;
}) {
  return (
    <div
      className={`xr-seg${full ? " xr-seg--full" : ""}`}
      role="radiogroup"
      aria-label={label}
      onKeyDown={rovingKeys}
    >
      {items.map((item) => (
        <button
          key={String(item.value)}
          type="button"
          role="radio"
          aria-checked={item.value === value}
          tabIndex={item.value === value ? 0 : -1}
          data-testid={
            testId ? `${testId}-${item.id ?? item.value}` : undefined
          }
          onClick={() => onPick(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  hint,
  testId,
  disabled = false,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  testId?: string;
  disabled?: boolean;
}) {
  return (
    <label className="xr-sw" data-disabled={disabled || undefined}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
    </label>
  );
}

/** Champ à pas : − / valeur / + (cibles de 44 px). */
export function Stepper({
  label,
  value,
  onStep,
  onCommit,
  invalid = false,
  testId,
  decLabel,
  incLabel,
}: {
  label: string;
  value: string;
  onStep: (direction: -1 | 1) => void;
  /** Saisie directe validée (Entrée ou sortie du champ) ; absent = lecture seule. */
  onCommit?: (text: string) => void;
  invalid?: boolean;
  testId?: string;
  decLabel: string;
  incLabel: string;
}) {
  return (
    <label className="xr-tfield">
      {label}
      <span className="stp">
        <button type="button" aria-label={decLabel} onClick={() => onStep(-1)}>
          −
        </button>
        <input
          key={value}
          defaultValue={value}
          readOnly={!onCommit}
          aria-invalid={invalid || undefined}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          data-testid={testId}
          onBlur={(event) => onCommit?.(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCommit?.(event.currentTarget.value);
            }
          }}
        />
        <button type="button" aria-label={incLabel} onClick={() => onStep(1)}>
          +
        </button>
      </span>
    </label>
  );
}
