import type { Metadata, Viewport } from "next";
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

export const metadata: Metadata = {
  title: "Atelier de revue",
  description:
    "Écouter, vérifier et corriger la reconnaissance des versets du Coran",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "dark light",
};

export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // Le script d'amorçage pose thème, police arabe et taille AVANT le premier rendu : sans lui la
    // page s'afficherait dans le thème du système puis « sauterait » (d'où suppressHydrationWarning).
    <html lang="fr" data-quran-font="amiri-quran" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOTSTRAP_INLINE }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
