import { apiError, json, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { cancelVideoJob, getVideoJob, publicJob } from "@/lib/video-jobs";
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

/** Annule un export en attente ou en cours : la place est rendue, l'état devient `failed` (« Export annulé. »). */
async function handleDELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; job: string }> },
) {
  const access = await sessionAccess(
    request,
    params as Promise<{ id: string }>,
    "view",
    { mutation: true },
  );
  if (!access.ok) return access.response;
  const job = getVideoJob((await params).job);
  if (!job || job.sessionId !== access.id || job.userId !== access.user.id)
    return apiError(404, "Export vidéo introuvable (ou expiré).");
  if (!cancelVideoJob(job.id))
    return apiError(409, "Cet export est déjà terminé.", { code: "finished" });
  return json({ job: publicJob(getVideoJob(job.id) ?? job) });
}

export const GET = safe(handleGET);
export const DELETE = safe(handleDELETE);
