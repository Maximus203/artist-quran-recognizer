"use client";
import Link from "next/link";
import type { Role } from "@/lib/users";
import { Icon } from "./icons";
import { isCurrent, navLeaves, navTree } from "./nav-entries";

/**
 * Navigation du tiroir de gauche (en dessous de 1280 px) : les mêmes pages, filtrées par rôle, depuis
 * `navTree`. Le tiroir n'a plus sa propre liste (elle montrait Performance à un récitateur).
 */
export function DrawerNav({ role, active }: { role: Role; active?: string }) {
  const leaves = navLeaves(navTree(role));
  return (
    <nav
      className="panel-nav only-drawer"
      aria-label="Pages"
      data-testid="drawer-nav"
    >
      {leaves.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          data-testid={`drawer-${item.id}`}
          aria-current={active === item.id ? "page" : undefined}
        >
          <Icon name={item.icon} />
          {item.label}
        </Link>
      ))}
      <Link href="/compte" data-testid="drawer-prefs">
        <Icon name="sliders" />
        Préférences
      </Link>
    </nav>
  );
}

/**
 * Navigation de la feuille du menu (téléphone) : le MÊME arbre que la barre du haut (`navTree`),
 * pages seules puis groupes déployés (Récitations, Administration). Rien n'est listé ici à la main.
 */
export function SheetNav({
  role,
  active,
  activeAdmin,
  onNavigate,
}: {
  role: Role;
  active: string;
  activeAdmin?: string;
  onNavigate?: () => void;
}) {
  const tree = navTree(role);
  return (
    <div className="menu-only-sm" data-testid="sheet-nav">
      <div className="menu-sep" />
      <p className="eyebrow menu-label">Aller à</p>
      {tree.map((node) =>
        node.kind === "link" ? (
          <Link
            key={node.id}
            role="menuitem"
            className="menu-item"
            href={node.href}
            data-testid={`sheet-${node.id}`}
            aria-current={
              isCurrent(node, active, activeAdmin) ? "page" : undefined
            }
            onClick={onNavigate}
          >
            <Icon name={node.icon} />
            {node.label}
          </Link>
        ) : (
          <div
            key={node.id}
            role="group"
            aria-label={node.label}
            className="menu-group"
          >
            <p className="eyebrow menu-label" aria-hidden="true">
              {node.label}
            </p>
            {node.items.map((item) => (
              <Link
                key={item.id}
                role="menuitem"
                className="menu-item"
                href={item.href}
                data-testid={`sheet-${item.id}`}
                aria-current={
                  isCurrent(item, active, activeAdmin) ? "page" : undefined
                }
                onClick={onNavigate}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            ))}
          </div>
        ),
      )}
    </div>
  );
}
