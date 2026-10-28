"use client";
import Link from "next/link";
import type { RefObject } from "react";
import { useEffectiveTheme } from "./hooks";
import { Icon } from "./icons";
import { AccountMenu } from "./account-menu";
import { useShell } from "./shell";

export type NavId = "revue" | "sessions" | "perf" | "live" | "docs" | "account";

type PanelToggle = {
  open: boolean;
  onToggle: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
};

type Props = {
  /** Page courante (soulignée dans la navigation). */
  active: NavId;
  /** Atelier seulement : panneau Sessions (à gauche), avec la pastille « à voir ». */
  left?: PanelToggle & { attention: number };
  /** Atelier seulement : panneau Revue humaine (à droite), absent hors session ouverte. */
  right?: PanelToggle & { available: boolean };
  /** Sur l'atelier, « Revue » reste sur la page : on change de vue sans recharger. */
  onRevue?: () => void;
  /** « Nouvel essai » : un geste sur l'atelier, un lien ailleurs. */
  onNew?: () => void;
};

const NAV: { id: NavId; href: string; label: string }[] = [
  { id: "revue", href: "/", label: "Revue" },
  { id: "sessions", href: "/sessions", label: "Sessions" },
  { id: "perf", href: "/performance", label: "Performance" },
  { id: "live", href: "/direct", label: "En direct" },
  { id: "docs", href: "/docs", label: "Documentation" },
];

/** Barre du haut commune à toutes les pages connectées. */
export function Header({ active, left, right, onRevue, onNew }: Props) {
  const { prefs, update } = useShell();
  const dark = useEffectiveTheme(prefs.theme) === "dark";
  return (
    <header className="header">
      {left ? (
        <button
          ref={left.buttonRef}
          type="button"
          className="btn btn--ghost btn--icon toggle-panel"
          data-testid="toggle-left"
          aria-controls="panel-left"
          aria-expanded={left.open}
          aria-label={
            left.attention > 0
              ? `Sessions, ${left.attention} à voir`
              : "Sessions"
          }
          onClick={left.onToggle}
        >
          <Icon name="panel-l" />
          {left.attention > 0 ? (
            <span
              className="dot"
              data-testid="attention-dot"
              aria-hidden="true"
            />
          ) : null}
        </button>
      ) : null}
      <Link className="brand" href="/" aria-label="Atelier de revue, accueil">
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
          <circle
            cx="16"
            cy="16"
            r="14"
            stroke="var(--accent)"
            strokeWidth="1.6"
          />
          <path
            d="M9.5 16h0M13 12v8M16 8.5v15M19 11v10M22.5 14v4"
            stroke="var(--text)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
        <b>
          Atelier <em>de revue</em>
        </b>
      </Link>
      <nav className="nav" aria-label="Pages">
        {NAV.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            data-testid={`nav-${item.id}`}
            aria-current={active === item.id ? "page" : undefined}
            onClick={(event) => {
              if (item.id === "revue" && onRevue) {
                event.preventDefault();
                onRevue();
              }
            }}
          >
            {item.id === "live" ? (
              <span className="livedot" aria-hidden="true" />
            ) : null}
            {item.label}
          </Link>
        ))}
      </nav>
      <span className="spacer" />
      <Link
        className="btn btn--secondary btn--icon btn--sm live-link"
        data-testid="nav-live-icon"
        href="/direct"
        aria-label="En direct"
        aria-current={active === "live" ? "page" : undefined}
      >
        <Icon name="live" />
      </Link>
      {onNew ? (
        <button
          type="button"
          className="btn btn--primary btn--sm"
          data-testid="new-trial"
          aria-label="Nouvel essai"
          onClick={onNew}
        >
          <Icon name="plus" />
          <span className="hide-compact">Nouvel essai</span>
        </button>
      ) : (
        <Link
          className="btn btn--primary btn--sm"
          data-testid="new-trial"
          aria-label="Nouvel essai"
          href="/?vue=new"
        >
          <Icon name="plus" />
          <span className="hide-compact">Nouvel essai</span>
        </Link>
      )}
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm hide-compact"
        data-testid="toggle-theme"
        aria-label="Basculer le thème clair / sombre"
        onClick={() => update({ theme: dark ? "light" : "dark" })}
      >
        <Icon name={dark ? "sun" : "moon"} />
      </button>
      <AccountMenu active={active} />
      {right ? (
        <button
          ref={right.buttonRef}
          type="button"
          className="btn btn--ghost btn--icon toggle-panel"
          data-testid="toggle-right"
          aria-controls="panel-right"
          aria-expanded={right.open}
          aria-label="Revue humaine"
          disabled={!right.available}
          onClick={right.onToggle}
        >
          <Icon name="panel-r" />
        </button>
      ) : null}
    </header>
  );
}
