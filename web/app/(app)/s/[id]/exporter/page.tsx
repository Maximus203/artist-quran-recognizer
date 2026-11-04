import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { exportReturnPath } from "@/lib/export-tab";
import { requirePageUser } from "@/lib/page-auth";
import { isSessionId } from "@/lib/session-id";
import { ExportPage } from "../../../../atelier/export/export-page";
import { PageFrame } from "../../../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Exporter · Quran TR",
};

/**
 * « Exporter les sous-titres » : le contrôle des passages ambigus de la partie coranique, les réglages et
 * l'export. Une session absente ou privée d'un autre se montre comme absente (jamais « privée »).
 */
export default async function ExportRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ onglet?: string | string[] }>;
}) {
  const { id } = await params;
  const { onglet } = await searchParams;
  if (!isSessionId(id)) notFound();
  await requirePageUser(exportReturnPath(id, onglet));
  return (
    <PageFrame active="revue">
      <ExportPage sessionId={id} tab={onglet} />
    </PageFrame>
  );
}
