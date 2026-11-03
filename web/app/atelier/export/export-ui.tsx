"use client";
import { useId, type KeyboardEvent, type ReactNode } from "react";
import { XIcon } from "./export-icons";

/**
 * Briques de l'écran d'export (direction « Le rouleau et les signets ») : chapitre repliable qui
 * affiche sa valeur courante, contrôle segmenté (radiogroup aux flèches), interrupteur, pas-à-pas.
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

export function Chapter({
  n,
  title,
  summary,
  open,
  onToggle,
  children,
  testId,
}: {
  n: number;
  title: string;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  testId?: string;
}) {
  const id = useId();
  return (
    <section
      className="xr-chap"
      data-open={open}
      aria-labelledby={`${id}-h`}
      data-testid={testId}
    >
      <header>
        <span className="n" aria-hidden="true">
          {n}
        </span>
        <h2 id={`${id}-h`}>{title}</h2>
        <span
          className="sum"
          data-testid={testId ? `${testId}-sum` : undefined}
        >
          {summary}
        </span>
        <button
          type="button"
          className="tog"
          aria-expanded={open}
          aria-controls={`${id}-b`}
          aria-label={open ? `Replier « ${title} »` : `Déplier « ${title} »`}
          onClick={onToggle}
        >
          <XIcon name="down" />
        </button>
      </header>
      <div className="body" id={`${id}-b`} hidden={!open}>
        {children}
      </div>
    </section>
  );
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
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <label className="xr-sw">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
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
