import type { Metadata } from "next";
import { requirePageUser } from "@/lib/page-auth";
import { DownloadsPane } from "../../atelier/downloads-pane";
import { PageFrame } from "../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Téléchargements · Quran TR" };

export default async function Page() {
  await requirePageUser("/telechargements");
  return (
    <PageFrame active="downloads">
      <DownloadsPane />
    </PageFrame>
  );
}
