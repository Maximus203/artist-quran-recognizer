"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icons";

export type NavMenuItem = {
  id: string;
  href: string;
  label: string;
};

/**
 * Un groupe de la barre du haut : un bouton qui déplie la liste de ses pages (Récitations, Administration…).
 * Se ferme à Échap, au clic ailleurs et dès qu'on choisit une page ; flèches haut/bas entre les entrées.
 */
export function NavMenu({
  id,
  label,
  items,
  active,
}: {
  id: string;
  label: string;
  items: readonly NavMenuItem[];
  /** Identifiant de la page courante : le groupe est souligné s'il la contient. */
  active: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const current = items.some((item) => item.id === active);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const entries = Array.from(
          wrap.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
            [],
        );
        if (entries.length === 0) return;
        const at = entries.indexOf(document.activeElement as HTMLElement);
        const step = event.key === "ArrowDown" ? 1 : -1;
        entries[(at + step + entries.length) % entries.length].focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  return (
    <div className="nav-group" ref={wrap} data-testid={`nav-group-${id}`}>
      <button
        ref={button}
        type="button"
        data-testid={`nav-${id}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-current={current ? "page" : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
        <Icon name="chevron-d" size={14} />
      </button>
      {open ? (
        <div id={menuId} className="nav-pop" role="menu" aria-label={label}>
          {items.map((item) => (
            <Link
              key={item.id}
              role="menuitem"
              href={item.href}
              data-testid={`nav-${item.id}`}
              aria-current={active === item.id ? "page" : undefined}
              onClick={() => close(false)}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
