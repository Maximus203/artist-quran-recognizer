import type { Metadata } from "next";
import { buildLinkMap } from "@/lib/docs-view";
import { loadDocsIndex, summarize } from "@/lib/docs";
import { requirePageUser } from "@/lib/page-auth";
import { DocsShell } from "../../atelier/docs-shell";
import { PageFrame } from "../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Documentation · Quran TR",
};

export default async function DocsHome() {
  await requirePageUser("/docs");
  const entries = await loadDocsIndex();
  return (
    <PageFrame active="docs">
      <DocsShell
        docs={entries.map(summarize)}
        links={buildLinkMap(entries)}
        current={null}
      />
    </PageFrame>
  );
}
