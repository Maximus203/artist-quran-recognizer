import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "Artist Quran Review",
  description: "Écouter et annoter les sorties du moteur coranique",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
