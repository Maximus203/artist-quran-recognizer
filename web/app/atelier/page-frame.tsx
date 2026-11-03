"use client";
import { Header, type NavId } from "./header";

/** Cadre commun des pages hors atelier : barre du haut + contenu. */
export function PageFrame({
  active,
  children,
}: {
  active: NavId;
  children: React.ReactNode;
}) {
  return (
    <div className="pg-shell" data-testid="page-frame">
      <Header active={active} />
      <main className="pg-main" id="main">
        {children}
      </main>
    </div>
  );
}
