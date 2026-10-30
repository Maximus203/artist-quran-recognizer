"use client";
import Link from "next/link";
import { Icon, type IconName } from "./icons";

export type AdminTab = "moteur" | "comptes" | "invitations";

const TABS: { id: AdminTab; href: string; label: string; icon: IconName }[] = [
  { id: "moteur", href: "/gestion/moteur", label: "Moteur", icon: "live" },
  { id: "comptes", href: "/gestion/comptes", label: "Comptes", icon: "users" },
  {
    id: "invitations",
    href: "/gestion/invitations",
    label: "Invitations",
    icon: "key",
  },
];

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
          {TABS.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              data-testid={`admin-tab-${item.id}`}
              aria-current={tab === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={{ display: "grid", gap: "var(--sp-5)", minWidth: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
