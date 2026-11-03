import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { parseByteRange } from "@/lib/byte-range";
import { apiError, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { getVideoJob } from "@/lib/video-jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * La vidéo de fond choisie pour ce job (muette, H.264), lue par le navigateur de rendu qui est connecté comme
 * l'appelant. Propre au job : elle ne sort que pour le compte qui l'a lancé et pour sa session ; servie par
 * intervalles d'octets (sinon on ne peut pas se positionner dans la vidéo).
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
  if (
    !job ||
    !job.backgroundVideo ||
    job.sessionId !== access.id ||
    job.userId !== access.user.id
  )
    return apiError(404, "Vidéo de fond introuvable.", { code: "missing" });
  let size: number;
  try {
    size = (await stat(job.backgroundVideo)).size;
  } catch {
    return apiError(404, "Vidéo de fond introuvable.", { code: "missing" });
  }
  const range = parseByteRange(request.headers.get("range"), size);
  if (range.kind === "unsatisfiable")
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` },
    });
  const start = range.kind === "partial" ? range.start : 0;
  const end = range.kind === "partial" ? range.end : size - 1;
  return new Response(
    Readable.toWeb(
      createReadStream(job.backgroundVideo, { start, end }),
    ) as ReadableStream,
    {
      status: range.kind === "partial" ? 206 : 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Type": "video/mp4",
        "Content-Length": String(end - start + 1),
        ...(range.kind === "partial"
          ? { "Content-Range": `bytes ${start}-${end}/${size}` }
          : {}),
        "Cache-Control": "private, no-store",
      },
    },
  );
}

export const GET = safe(handleGET);
