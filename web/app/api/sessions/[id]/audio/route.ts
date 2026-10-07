import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { audioPath } from "@/lib/store";
import { isLocalRequest } from "@/lib/local-request";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const { id } = await params,
      file = await audioPath(id),
      size = (await stat(file)).size;
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
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Audio introuvable" }, { status: 404 });
  }
}
