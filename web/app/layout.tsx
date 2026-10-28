import type { Metadata, Viewport } from "next";
import { readPreferences } from "@/lib/preferences";
import { appearanceOf } from "@/lib/prefs-sync";
import { pageUser } from "@/lib/page-auth";
import { ready } from "@/lib/server-init";
import { BOOTSTRAP_INLINE } from "@/lib/ui-bootstrap";
import "./tokens.css";
import "./fonts.css";
import "./base.css";
import "./shell.css";
import "./sessions.css";
import "./console.css";
import "./passage.css";
import "./review.css";
import "./perf.css";
import "./phase2.css";
import "./pages.css";
import "./live.css";
import "./export.css";

export const metadata: Metadata = {
  title: "Quran TR",
  description:
    "Écouter, vérifier et corriger la reconnaissance des versets du Coran",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
};

export default async function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // Connecté : les préférences DU COMPTE posent thème, police et taille dans le HTML lui-même
  // (aucun clignotement, quel que soit l'appareil). Anonyme (connexion, inscription) : seul le
  // thème mémorisé par le navigateur est repris, par un petit script avant le premier rendu.
  const user = await pageUser();
  const appearance = user
    ? appearanceOf(readPreferences(await ready(), user.id).preferences)
    : null;
  return (
    <html
      lang="fr"
      data-theme={appearance?.theme ?? undefined}
      data-quran-font={appearance?.font ?? "amiri-quran"}
      style={
        appearance?.quranSize
          ? ({ "--quran-size": appearance.quranSize } as React.CSSProperties)
          : undefined
      }
      suppressHydrationWarning
    >
      <head>
        {user ? null : (
          <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP_INLINE }} />
        )}
      </head>
      <body>{children}</body>
    </html>
  );
}
