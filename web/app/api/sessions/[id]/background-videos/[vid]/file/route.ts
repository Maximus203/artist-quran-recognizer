import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  clipFailure,
  clipRoute,
  type ClipParams,
} from "@/lib/background-video-http";
import { readyClip } from "@/lib/background-video-store";
import { parseByteRange } from "@/lib/byte-range";
import { safe } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * La copie préparée de la vidéo de fond (muette, H.264), pour CE compte et CETTE session seulement. Servie par
 * intervalles d'octets : sans eux, un navigateur ne peut pas se positionner dans la vidéo. `409` tant qu'elle
 * n'est pas prête.
 */
async function handleGET(request: Request, { params }: { params: ClipParams }) {
  const route = await clipRoute(request, params);
  if (!route.ok) return route.response;
  try {
    const clip = await readyClip(route.ctx);
    const range = parseByteRange(request.headers.get("range"), clip.size);
    if (range.kind === "unsatisfiable")
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${clip.size}` },
      });
    const start = range.kind === "partial" ? range.start : 0;
    const end = range.kind === "partial" ? range.end : clip.size - 1;
    return new Response(
      Readable.toWeb(
        createReadStream(clip.path, { start, end }),
      ) as ReadableStream,
      {
        status: range.kind === "partial" ? 206 : 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Type": "video/mp4",
          "Content-Length": String(end - start + 1),
          ...(range.kind === "partial"
            ? { "Content-Range": `bytes ${start}-${end}/${clip.size}` }
            : {}),
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    return clipFailure(error);
  }
}

export const GET = safe(handleGET);
