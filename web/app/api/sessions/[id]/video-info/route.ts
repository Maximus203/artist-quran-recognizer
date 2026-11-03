import { NextResponse } from "next/server";
import { isVideoContainer } from "@/lib/listening";
import { audioPath, readSession } from "@/lib/store";
import {
  NO_VIDEO,
  needsBrowserCopy,
  readyBrowserFile,
  videoInfoOf,
} from "@/lib/video-browser-copy";
import { safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
export const runtime = "nodejs";

/**
 * La session a-t-elle une image, et de quelle taille ? C'est le SERVEUR qui répond (ffprobe), pas le
 * navigateur : un téléphone qui ne décode pas le HEVC ne doit jamais faire disparaître « Vidéo d'origine »
 * des choix de fond. Qui voit la session lit ceci ; privée = son propriétaire.
 *
 * `browser_ready` dit si CE navigateur pourra afficher l'aperçu ; l'export, lui, se fait sur le serveur
 * (avec une copie H.264 si la source n'est pas lisible) et ne dépend pas de l'appareil de la personne.
 */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  const headers = { "Cache-Control": "private, no-store" };
  try {
    const session = await readSession(access.id);
    if (!isVideoContainer(session.extension))
      return NextResponse.json(
        { has_video: false, reason: "audio" },
        { headers },
      );
    const source = await audioPath(access.id);
    const info = await videoInfoOf(source);
    if (info === null)
      return NextResponse.json(
        { has_video: false, reason: "unreadable" },
        { headers },
      );
    if (info === NO_VIDEO)
      return NextResponse.json(
        { has_video: false, reason: "audio_only" },
        { headers },
      );
    // Prépare tout de suite la copie H.264 d'une source illisible : elle sera prête pour l'export.
    void readyBrowserFile(access.id, source).catch(() => undefined);
    return NextResponse.json(
      {
        has_video: true,
        width: info.width,
        height: info.height,
        codec: info.codec,
        browser_ready: !needsBrowserCopy(info.codec),
      },
      { headers },
    );
  } catch {
    return NextResponse.json({ error: "Vidéo introuvable" }, { status: 404 });
  }
}

export const GET = safe(handleGET);
