"use client";
import { useRef } from "react";

/** Interrupteur (`role="switch"`) avec son état écrit : « Oui / Non » ou « Ouvert / Fermé ». */
export function Switch({
  checked,
  onChange,
  label,
  yes = "Oui",
  no = "Non",
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  yes?: string;
  no?: string;
  testId?: string;
}) {
  return (
    <button
      className="switch"
      type="button"
      role="switch"
      data-testid={testId}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <i />
      <span className="state-txt">{checked ? yes : no}</span>
    </button>
  );
}

export type Choice<T extends string> = {
  value: T;
  label: React.ReactNode;
};

/** Groupe de choix exclusifs : `role="radiogroup"`, flèches du clavier, un seul arrêt de tabulation. */
export function SegControl<T extends string>({
  value,
  options,
  onChange,
  labelledBy,
  testId,
}: {
  value: T;
  options: readonly Choice<T>[];
  onChange: (value: T) => void;
  labelledBy: string;
  testId?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  const move = (event: React.KeyboardEvent, index: number) => {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    group.current
      ?.querySelectorAll<HTMLElement>('[role="radio"]')
      [(index + step + options.length) % options.length]?.focus();
  };
  return (
    <div
      ref={group}
      className="seg-ctl"
      role="radiogroup"
      aria-labelledby={labelledBy}
      data-testid={testId}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          data-v={option.value}
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => move(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
