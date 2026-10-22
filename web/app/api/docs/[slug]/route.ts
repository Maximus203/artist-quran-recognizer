import { readDoc } from "@/lib/docs";
import { notFound, safe } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
export const runtime = "nodejs";

/** Markdown brut d'un document de l'index (`text/markdown`). `404` pour tout slug hors de l'index. */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const content = await readDoc((await params).slug);
  if (content === null) return notFound("Document introuvable");
  return new Response(content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const GET = safe(handleGET);
