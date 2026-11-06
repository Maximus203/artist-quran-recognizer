import type { Metadata } from "next";
import { requirePageUser } from "@/lib/page-auth";
import { FilesPane } from "../../atelier/files-pane";
import { PageFrame } from "../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Fichiers · Quran TR" };

export default async function Page() {
  await requirePageUser("/fichiers");
  return (
    <PageFrame active="files">
      <FilesPane />
    </PageFrame>
  );
}
