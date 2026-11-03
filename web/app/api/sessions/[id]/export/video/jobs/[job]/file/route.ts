import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { apiError, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { readSession } from "@/lib/store";
import { videoFileName } from "@/lib/export-video-name";
import { getVideoJob } from "@/lib/video-jobs";
export const runtime = "nodejs";

/**
 * Le MP4 d'un export vidéo terminé (`409` tant qu'il n'est pas prêt). Un export à plusieurs plages
 * produit plusieurs MP4 : `?index=N` (0 par défaut, voir `downloads` du job). Conservé une heure.
 */
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
  const raw = new URL(request.url).searchParams.get("index");
  const index = raw === null ? 0 : Number(raw);
  const entry = Number.isInteger(index) ? job.files[index] : undefined;
  if (!entry)
    return apiError(
      404,
      `Cet export n'a pas de vidéo n° ${raw} (il y en a ${job.files.length}).`,
      { code: "not_found" },
    );
  const size = (await stat(entry.path)).size;
  const session = await readSession(access.id);
  const name = entry.name || videoFileName(session.name, job.options.file_name);
  return new Response(
    Readable.toWeb(createReadStream(entry.path)) as ReadableStream,
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
