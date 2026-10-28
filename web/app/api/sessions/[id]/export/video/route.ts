import { NextResponse } from "next/server";
import {
  MAX_SEGMENT_BYTES,
  muxVideoFrames,
  writeFrameSegment,
} from "@/lib/export-video";
import { exportErrorResponse } from "@/lib/export-errors";
import { safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
export const runtime = "nodejs";

const HEADER_JOB = "x-aqr-job";
const HEADER_PART = "x-aqr-part";
const HEADER_LAST = "x-aqr-last";

function headerNumber(request: Request, name: string): number | null {
  const raw = request.headers.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * Vidéo animée d'une session (MP4). Le navigateur rend et encode les frames (H.264
 * Annex B) ; il les envoie ici segment par segment : `POST` binaire
 * (`content-type: video/h264`, en-têtes `x-aqr-job`, `x-aqr-part`, `x-aqr-last: 1`),
 * le dernier segment déclenche le mux avec la copie d'écoute et répond le MP4 en
 * pièce jointe. Session non terminée : `409 not_ready` ; segments non contigus ou
 * vides : `400`.
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  try {
    const job = request.headers.get(HEADER_JOB);
    const part = headerNumber(request, HEADER_PART);
    if (!job || part === null)
      return NextResponse.json(
        {
          error: `En-têtes requis : ${HEADER_JOB}, ${HEADER_PART}, ${HEADER_LAST}.`,
        },
        { status: 400 },
      );
    const data = Buffer.from(await request.arrayBuffer());
    if (data.length === 0)
      return NextResponse.json({ error: "Segment vide." }, { status: 400 });
    if (data.length > MAX_SEGMENT_BYTES)
      return NextResponse.json(
        { error: "Segment trop volumineux (256 Mio au plus)." },
        { status: 400 },
      );
    await writeFrameSegment(access.id, job, part, data);
    if (request.headers.get(HEADER_LAST) !== "1")
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "private, no-store" },
      });

    const file = await muxVideoFrames(access.id, job);
    return new Response(new Uint8Array(file.content), {
      headers: {
        "Content-Type": file.mime,
        "Content-Disposition": `attachment; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return exportErrorResponse(error) ?? Promise.reject(error);
  }
}

export const POST = safe(handlePOST);
