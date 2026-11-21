"use client";
import Link from "next/link";
import { Icon } from "./icons";
import { ADMIN_ITEMS } from "./nav-entries";

export type AdminTab = "moteur" | "comptes" | "invitations";

/** Cadre de la zone Administration (réservée aux administrateurs) : titre, sections et contenu. */
export function AdminFrame({
  tab,
  children,
}: {
  tab: AdminTab;
  children: React.ReactNode;
}) {
  return (
    <div className="page" style={{ maxWidth: 1080 }} data-testid="admin-page">
      <div className="pg-title">
        <div>
          <h1>Administration</h1>
          <p>Le moteur d’analyse, les comptes et l’accès des testeurs.</p>
        </div>
      </div>
      <div className="acct-layout">
        <nav className="subnav" aria-label="Sections de l’administration">
          {ADMIN_ITEMS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              data-testid={`admin-tab-${item.id.replace("admin-", "")}`}
              aria-current={item.id === `admin-${tab}` ? "page" : undefined}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="acct-main">
          {children}
        </div>
      </div>
    </div>
  );
}
