import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { apiError, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { readSession } from "@/lib/store";
import { getVideoJob } from "@/lib/video-jobs";
export const runtime = "nodejs";

/** Le MP4 d'un export vidéo terminé (`409` tant qu'il n'est pas prêt). Conservé une heure. */
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
  if (job.state !== "done" || !job.file)
    return apiError(409, `Export ${job.state} : la vidéo n'est pas prête.`, {
      code: "not_ready",
    });
  const size = (await stat(job.file)).size;
  const session = await readSession(access.id);
  const name = `quran-tr-${session.name.replace(/[^\w.-]+/g, "_") || access.id}.mp4`;
  return new Response(
    Readable.toWeb(createReadStream(job.file)) as ReadableStream,
    {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(size),
        "Content-Disposition": `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "private, no-store",
      },
    },
  );
}

export const GET = safe(handleGET);
