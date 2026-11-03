import { readFile } from "node:fs/promises";
import { apiError, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { getVideoJob } from "@/lib/video-jobs";
export const runtime = "nodejs";

/** L'image de fond envoyée avec la demande (lue par le navigateur de rendu). */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string; job: string }> },
) {
  const access = await sessionAccess(
    request,
    params as Promise<{ id: string }>,
    "view",
  );
  if (!access.ok) return access.response;
  const job = getVideoJob((await params).job);
  if (
    !job ||
    !job.background ||
    job.sessionId !== access.id ||
    job.userId !== access.user.id
  )
    return apiError(404, "Image de fond introuvable.");
  return new Response(new Uint8Array(await readFile(job.background)), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "private, no-store",
    },
  });
}

export const GET = safe(handleGET);
