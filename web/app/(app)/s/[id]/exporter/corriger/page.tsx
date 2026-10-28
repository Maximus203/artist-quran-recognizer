import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/lib/page-auth";
import { isSessionId } from "@/lib/session-id";
import { CorrectPage } from "../../../../../atelier/export/correct-item";
import { PageFrame } from "../../../../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Corriger un passage · Quran TR",
};

/** Clé d'un passage à vérifier : l'empreinte de l'intervalle (ou un signalement) et la sorte de passage. */
const ITEM_KEY =
  /^(?:[0-9a-f]{64}#(?:uncertain|inferred|cut|approx|report)|report:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}#report)$/;

export default async function CorrectRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  const { id } = await params;
  if (!isSessionId(id)) notFound();
  const { item } = await searchParams;
  const key = typeof item === "string" ? item : "";
  await requirePageUser(
    `/s/${id}/exporter/corriger${key ? `?item=${encodeURIComponent(key)}` : ""}`,
  );
  if (!ITEM_KEY.test(key)) redirect(`/s/${id}/exporter`);
  return (
    <PageFrame active="revue">
      <CorrectPage sessionId={id} itemKey={key} />
    </PageFrame>
  );
}
