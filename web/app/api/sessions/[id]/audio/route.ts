import { safe } from "@/lib/http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { audioPath, readSession, sessionDir } from "@/lib/store";
import { ensureListening, mediaType } from "@/lib/listening";
import { sessionAccess } from "@/lib/route-guard";
export const runtime = "nodejs";
/**
 * Audio du lecteur : la copie d'écoute (PCM décodé comme le moteur, positionnement exact).
 * Repli sur l'original si ffmpeg échoue, signalé par `X-AQR-Listening: original`.
 * Lisible par tout testeur qui voit la session (privée : seul son propriétaire, sinon 404).
 */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  try {
    const id = access.id,
      source = await audioPath(id);
    let file = source,
      type = mediaType((await readSession(id)).extension),
      kind = "original";
    try {
      file = (await ensureListening(sessionDir(id), source)).wav;
      type = "audio/wav";
      kind = "engine-pcm";
    } catch {
      /* repli : l'original reste écoutable, la page affiche l'avertissement */
    }
    const size = (await stat(file)).size;
    const m = request.headers.get("range")?.match(/^bytes=(\d+)-(\d*)$/);
    const start = m ? Number(m[1]) : 0,
      end = m ? Math.min(size - 1, m[2] ? Number(m[2]) : size - 1) : size - 1;
    if (start > end || start >= size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    const body = Readable.toWeb(
      createReadStream(file, { start, end }),
    ) as ReadableStream;
    return new Response(body, {
      status: m ? 206 : 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": String(end - start + 1),
        ...(m ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
        "Content-Type": type,
        "X-AQR-Listening": kind,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Audio introuvable" }, { status: 404 });
  }
}

export const GET = safe(handleGET);
