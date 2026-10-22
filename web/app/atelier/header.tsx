"use client";
import type { RefObject } from "react";
import { Icon } from "./icons";

export type View = "revue" | "perf" | "new";

type Props = {
  view: View;
  onView: (view: View) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  /** Le panneau de revue n'a de sens que sur une session ouverte, dans la vue Revue. */
  rightAvailable: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  /** Non lus + analyses actives : la pastille reste visible panneau fermé. */
  attention: number;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  leftButton: RefObject<HTMLButtonElement | null>;
  rightButton: RefObject<HTMLButtonElement | null>;
};

export function Header(props: Props) {
  const { view } = props;
  return (
    <header className="header">
      <button
        ref={props.leftButton}
        type="button"
        className="btn btn--ghost btn--icon toggle-panel"
        data-testid="toggle-left"
        aria-controls="panel-left"
        aria-expanded={props.leftOpen}
        aria-label={
          props.attention > 0
            ? `Sessions, ${props.attention} à voir`
            : "Sessions"
        }
        onClick={props.onToggleLeft}
      >
        <Icon name="panel-l" />
        {props.attention > 0 ? (
          <span
            className="dot"
            data-testid="attention-dot"
            aria-hidden="true"
          />
        ) : null}
      </button>
      <div className="brand">
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
      </div>
      <nav className="nav" aria-label="Vues">
        <button
          type="button"
          data-testid="nav-revue"
          aria-current={view === "revue" ? "page" : undefined}
          onClick={() => props.onView("revue")}
        >
          Revue
        </button>
        <button
          type="button"
          data-testid="nav-perf"
          aria-current={view === "perf" ? "page" : undefined}
          onClick={() => props.onView("perf")}
        >
          Performance
        </button>
      </nav>
      <span className="spacer" />
      <button
        type="button"
        className="btn btn--primary btn--sm"
        data-testid="new-trial"
        aria-label="Nouvel essai"
        onClick={() => props.onView("new")}
      >
        <Icon name="plus" />
        <span className="hide-sm">Nouvel essai</span>
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--icon btn--sm"
        data-testid="toggle-theme"
        aria-label="Basculer le thème clair / sombre"
        onClick={props.onToggleTheme}
      >
        <Icon name={props.theme === "dark" ? "sun" : "moon"} />
      </button>
      <button
        ref={props.rightButton}
        type="button"
        className="btn btn--ghost btn--icon toggle-panel"
        data-testid="toggle-right"
        aria-controls="panel-right"
        aria-expanded={props.rightOpen}
        aria-label="Revue humaine"
        disabled={!props.rightAvailable}
        onClick={props.onToggleRight}
      >
        <Icon name="panel-r" />
      </button>
    </header>
  );
}
