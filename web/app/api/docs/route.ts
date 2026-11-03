import { loadDocsIndex, summarize } from "@/lib/docs";
import { json, safe } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/** Index de la documentation (`docs/docs-index.json`) : `{ docs: [{ slug, title, section }] }`. Testeurs connectés. */
async function handleGET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  return json({ docs: (await loadDocsIndex()).map(summarize) });
}

export const GET = safe(handleGET);
