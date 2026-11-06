"use client";
import Link from "next/link";
import type { RefObject } from "react";
import { useEffectiveTheme } from "./hooks";
import { Icon } from "./icons";
import { AccountMenu } from "./account-menu";
import { NavMenu } from "./nav-menu";
import { pageVisibleTo, type PageId } from "@/lib/role-view";
import { useShell } from "./shell";

export type NavId =
  | "revue"
  | "sessions"
  | "playlists"
  | "files"
  | "perf"
  | "live"
  | "docs"
  | "admin"
  | "account";

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
  /** Pages d'administration : l'onglet courant (moteur, comptes, invitations). */
  activeAdmin?: string;
};

const LINKS: Record<PageId, { href: string; label: string }> = {
  revue: { href: "/", label: "Lecture" },
  sessions: { href: "/sessions", label: "Récitations" },
  playlists: { href: "/playlists", label: "Playlists" },
  files: { href: "/fichiers", label: "Fichiers" },
  perf: { href: "/performance", label: "Performance" },
  live: { href: "/direct", label: "En direct" },
  docs: { href: "/docs", label: "Documentation" },
};

/** Les pages qui se rangent sous « Récitations » : la liste, les playlists, puis les fichiers. */
const LIBRARY: PageId[] = ["sessions", "playlists", "files"];
/** Le reste, à plat, dans l'ordre de la barre. */
const FLAT_AFTER: PageId[] = ["perf", "live", "docs"];

/** Administration : réservée à l'administrateur. */
const ADMIN_ITEMS = [
  { id: "admin-moteur", href: "/gestion/moteur", label: "Moteur" },
  { id: "admin-comptes", href: "/gestion/comptes", label: "Comptes" },
  {
    id: "admin-invitations",
    href: "/gestion/invitations",
    label: "Invitations",
  },
] as const;

/** Barre du haut commune à toutes les pages connectées. */
export function Header({
  active,
  left,
  right,
  onRevue,
  onNew,
  activeAdmin,
}: Props) {
  const { prefs, update, user } = useShell();
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
              : "Récitations"
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
      <Link className="brand" href="/" aria-label="Quran TR, accueil">
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
          Quran <em>TR</em>
        </b>
      </Link>
      <nav className="nav" aria-label="Pages">
        {pageVisibleTo(user.role, "revue") ? (
          <Link
            href={LINKS.revue.href}
            data-testid="nav-revue"
            aria-current={active === "revue" ? "page" : undefined}
            onClick={(event) => {
              if (onRevue) {
                event.preventDefault();
                onRevue();
              }
            }}
          >
            {LINKS.revue.label}
          </Link>
        ) : null}
        <NavMenu
          id="library"
          label="Récitations"
          active={active}
          items={LIBRARY.filter((id) => pageVisibleTo(user.role, id)).map(
            (id) => ({ id, ...LINKS[id] }),
          )}
        />
        {FLAT_AFTER.filter((id) => pageVisibleTo(user.role, id)).map((id) => (
          <Link
            key={id}
            href={LINKS[id].href}
            data-testid={`nav-${id}`}
            aria-current={active === id ? "page" : undefined}
          >
            {id === "live" ? (
              <span className="livedot" aria-hidden="true" />
            ) : null}
            {LINKS[id].label}
          </Link>
        ))}
        {user.role === "admin" ? (
          <NavMenu
            id="admin"
            label="Administration"
            active={
              active === "admin" ? (activeAdmin ?? "admin-moteur") : active
            }
            items={ADMIN_ITEMS}
          />
        ) : null}
      </nav>
      <span className="spacer" />
      {pageVisibleTo(user.role, "live") ? (
        <Link
          className="btn btn--secondary btn--icon btn--sm live-link"
          data-testid="nav-live-icon"
          href="/direct"
          aria-label="En direct"
          aria-current={active === "live" ? "page" : undefined}
        >
          <Icon name="live" />
        </Link>
      ) : null}
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
