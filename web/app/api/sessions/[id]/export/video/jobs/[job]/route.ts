import { apiError, json, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { getVideoJob, publicJob } from "@/lib/video-jobs";
export const runtime = "nodejs";

/** État d'un export vidéo : `queued`, `running` (avec l'avancement), `done` ou `failed` (avec l'erreur). */
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
  if (!job || job.sessionId !== access.id || job.userId !== access.user.id)
    return apiError(404, "Export vidéo introuvable (ou expiré).");
  return json({ job: publicJob(job) });
}

export const GET = safe(handleGET);
