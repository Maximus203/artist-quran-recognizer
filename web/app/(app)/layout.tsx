import { pageUser } from "@/lib/page-auth";
import { loadShellData } from "@/lib/shell-data";
import { ShellProvider } from "../atelier/shell";

export const dynamic = "force-dynamic";

/**
 * Coque des pages connectées. Le compte, ses préférences et son stockage sont lus ICI, côté
 * serveur, et vivent dans un fournisseur qui reste monté quand on passe d'une page à l'autre
 * (une préférence en cours d'envoi n'est jamais perdue par une navigation). Sans compte, chaque
 * page redirige elle-même vers /login en gardant sa propre adresse.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await pageUser();
  if (!user) return <>{children}</>;
  const data = await loadShellData(user);
  return (
    <ShellProvider
      user={data.user}
      preferences={data.preferences}
      quota={data.quota}
      repoUrl={data.repoUrl}
    >
      {children}
    </ShellProvider>
  );
}
