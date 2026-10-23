import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/page-auth";
import { isSessionId } from "@/lib/session-id";
import { ExportPage } from "../../../../atelier/export/export-page";
import { PageFrame } from "../../../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Exporter les sous-titres · Atelier de revue",
};

/**
 * « Exporter les sous-titres » : le contrôle des passages ambigus de la partie coranique, les réglages et
 * l'export. Une session absente ou privée d'un autre se montre comme absente (jamais « privée »).
 */
export default async function ExportRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isSessionId(id)) notFound();
  await requirePageUser(`/s/${id}/exporter`);
  return (
    <PageFrame active="revue">
      <ExportPage sessionId={id} />
    </PageFrame>
  );
}
