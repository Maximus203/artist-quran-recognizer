"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { formatBytesFr } from "@/lib/format";
import { storageState } from "@/lib/storage-meter";
import { Avatar } from "./avatar";
import type { NavId } from "./header";
import { Icon, type IconName } from "./icons";
import { useShell } from "./shell";

const THEMES = [
  { id: "light", label: "Clair" },
  { id: "dark", label: "Sombre" },
  { id: "system", label: "Système" },
] as const;

const GO_TO: { id: NavId; href: string; label: string; icon: IconName }[] = [
  { id: "revue", href: "/", label: "Revue", icon: "wave" },
  { id: "sessions", href: "/sessions", label: "Sessions", icon: "list" },
  { id: "perf", href: "/performance", label: "Performance", icon: "gauge" },
  { id: "docs", href: "/docs", label: "Documentation", icon: "book" },
];

const MENU_ITEMS = '[role="menuitem"], .menu-theme button, .menu-quota a';

/** Menu du compte : préférences, statistiques, thème, espace utilisé, déconnexion. */
export function AccountMenu({ active }: { active: NavId }) {
  const { user, prefs, update, quota } = useShell();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>(MENU_ITEMS)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "Tab") close(false);
      else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = Array.from(
          menu.current?.querySelectorAll<HTMLElement>(MENU_ITEMS) ?? [],
        );
        if (items.length === 0) return;
        const at = items.indexOf(document.activeElement as HTMLElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        items[(at + step + items.length) % items.length].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  const logout = async () => {
    setBusy(true);
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* déconnexion idempotente : on repart de toute façon vers la connexion */
    }
    location.assign("/login");
  };

  const space = storageState(quota);
  const joined = new Date(user.created_at).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="pop-wrap" data-testid="account">
      <button
        ref={button}
        type="button"
        className="acct-btn"
        data-testid="account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <Avatar person={user} size="md" eager />
        <span className="acct-name" data-testid="account-name">
          {user.username}
        </span>
        <span className="sr"> (menu du compte)</span>
        <Icon name="chevron-d" />
      </button>
      {open ? (
        <>
          <div
            className="sheet-scrim menu-scrim"
            aria-hidden="true"
            onClick={() => close(false)}
          />
          <div
            ref={menu}
            id={menuId}
            className="menu"
            role="menu"
            aria-label="Compte"
          >
            <div className="menu-head">
              <Avatar person={user} size="lg" eager />
              <div>
                <b>{user.username}</b>
                <small>
                  {user.role === "admin" ? "Administrateur" : "Testeur"} ·
                  inscrit le {joined}
                </small>
              </div>
            </div>
            <div className="menu-only-sm">
              <div className="menu-sep" />
              <p className="eyebrow menu-label">Aller à</p>
              {GO_TO.map((item) => (
                <Link
                  key={item.id}
                  role="menuitem"
                  className="menu-item"
                  href={item.href}
                  aria-current={active === item.id ? "page" : undefined}
                  onClick={() => close(false)}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </Link>
              ))}
            </div>
            <div className="menu-sep" />
            <Link
              role="menuitem"
              className="menu-item"
              href="/compte"
              data-testid="menu-prefs"
              onClick={() => close(false)}
            >
              <Icon name="sliders" />
              Préférences
            </Link>
            <Link
              role="menuitem"
              className="menu-item"
              href="/compte/statistiques"
              data-testid="menu-stats"
              onClick={() => close(false)}
            >
              <Icon name="chart" />
              Mes statistiques
            </Link>
            <p className="eyebrow menu-label" id={`${menuId}-theme`}>
              Thème
            </p>
            <div
              className="menu-theme"
              role="group"
              aria-labelledby={`${menuId}-theme`}
            >
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  data-testid={`theme-${theme.id}`}
                  aria-pressed={prefs.theme === theme.id}
                  onClick={() => update({ theme: theme.id })}
                >
                  {theme.label}
                </button>
              ))}
            </div>
            <div className="menu-quota" data-testid="menu-quota">
              <span>
                Espace utilisé :{" "}
                <b
                  className="mono"
                  style={{ fontWeight: 600, color: "var(--text)" }}
                >
                  {formatBytesFr(quota.used_bytes)}
                </b>
                {quota.limit_bytes
                  ? ` sur ${formatBytesFr(quota.limit_bytes)}`
                  : " (sans limite)"}{" "}
                ·{" "}
                <Link href="/compte/statistiques" onClick={() => close(false)}>
                  détails
                </Link>
              </span>
              {quota.limit_bytes ? (
                <div className="quota-hint">
                  <span className="mini" style={{ flex: 1 }}>
                    <i
                      style={
                        { "--w": `${space.percent}%` } as React.CSSProperties
                      }
                    />
                  </span>
                </div>
              ) : null}
            </div>
            <div className="menu-sep" />
            <button
              type="button"
              role="menuitem"
              className="menu-item menu-item--danger"
              data-testid="logout"
              disabled={busy}
              onClick={() => void logout()}
            >
              <Icon name="logout" />
              Se déconnecter
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
