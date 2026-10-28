import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { isVideoContainer, videoMediaType } from "@/lib/listening";
import { audioPath, readSession } from "@/lib/store";
import { safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * Vidéo originale d'une session (fond de l'export vidéo animé) : servie uniquement si le
 * fichier source est un conteneur vidéo. Qui voit la session la voit ; privée = son
 * propriétaire. Le corps complet est renvoyé (le navigateur la décode image par image).
 */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  try {
    const session = await readSession(access.id);
    if (!isVideoContainer(session.extension))
      return NextResponse.json(
        { error: "Cette session n'a pas de piste vidéo." },
        { status: 404 },
      );
    const file = await audioPath(access.id);
    const size = (await stat(file)).size;
    const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
    return new Response(body, {
      headers: {
        "Content-Type": videoMediaType(session.extension),
        "Content-Length": String(size),
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Vidéo introuvable" }, { status: 404 });
  }
}

export const GET = safe(handleGET);
