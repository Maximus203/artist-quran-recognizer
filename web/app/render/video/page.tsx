import type { Metadata } from "next";
import { RenderClient } from "./render-client";

export const metadata: Metadata = {
  title: "Rendu vidéo · Quran TR",
  robots: { index: false },
};

export default function RenderVideoPage() {
  return <RenderClient />;
}
