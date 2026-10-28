import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { buildLinkMap } from "@/lib/docs-view";
import { SLUG, loadDocsIndex, readDoc, summarize } from "@/lib/docs";
import { requirePageUser } from "@/lib/page-auth";
import { DocsShell } from "../../../atelier/docs-shell";
import { PageFrame } from "../../../atelier/page-frame";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Documentation · Quran TR",
};

/**
 * Un document de l'index (liste blanche : `docs/docs-index.json`). Le slug de l'adresse n'est
 * jamais un chemin : il ne sert qu'à retrouver une entrée de l'index.
 */
export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await requirePageUser(`/docs/${encodeURIComponent(slug)}`);
  if (!SLUG.test(slug)) notFound();
  const entries = await loadDocsIndex();
  const entry = entries.find((item) => item.slug === slug);
  const markdown = entry ? await readDoc(slug) : null;
  if (!entry || markdown === null) notFound();
  return (
    <PageFrame active="docs">
      <DocsShell
        docs={entries.map(summarize)}
        links={buildLinkMap(entries)}
        current={{ doc: summarize(entry), markdown }}
      />
    </PageFrame>
  );
}
