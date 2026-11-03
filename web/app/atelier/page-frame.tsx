"use client";
import { Header, type NavId } from "./header";

/** Cadre commun des pages hors atelier : barre du haut + contenu. */
export function PageFrame({
  active,
  activeAdmin,
  children,
}: {
  active: NavId;
  /** Administration : l'entrée du menu à souligner. */
  activeAdmin?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="pg-shell" data-testid="page-frame">
      <Header active={active} activeAdmin={activeAdmin} />
      <main className="pg-main" id="main">
        {children}
      </main>
    </div>
  );
}
