import { readFile } from "node:fs/promises";
import { apiError, safe } from "@/lib/http";
import { ensureListening, isVideoContainer } from "@/lib/listening";
import { sessionAccess } from "@/lib/route-guard";
import { audioPath, readSession, sessionDir } from "@/lib/store";
import { ensureThumbnails, parseThumbnailQuery } from "@/lib/video-thumbnails";
export const runtime = "nodejs";

/**
 * Imagettes d'une session VIDÉO pour la frise d'export : une planche JPEG horizontale de `count`
 * images (1 à 120, défaut 40) larges de `width` px (32 à 320, défaut 96). L'image i montre l'instant
 * (i + 0,5) × durée / count. Mise en cache dans les fichiers dérivés de la session. Qui voit la
 * session la voit. 409 si la session n'a pas de piste vidéo, 400 si un paramètre sort des bornes.
 */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  const query = parseThumbnailQuery(new URL(request.url).searchParams);
  if (!query.ok) return apiError(400, query.error, { code: "invalid" });
  const session = await readSession(access.id);
  if (!isVideoContainer(session.extension))
    return apiError(409, "Cette session n'a pas de piste vidéo.", {
      code: "no_video",
    });
  try {
    const dir = sessionDir(access.id);
    const source = await audioPath(access.id);
    const listening = await ensureListening(dir, source);
    const { duration } = JSON.parse(await readFile(listening.peaks, "utf8")) as {
      duration: number;
    };
    const file = await ensureThumbnails(dir, source, {
      count: query.count,
      width: query.width,
      duration,
    });
    return new Response(await readFile(file), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=3600",
        "X-Aqr-Thumb-Count": String(query.count),
        "X-Aqr-Thumb-Every": String(duration / query.count),
      },
    });
  } catch (e) {
    return apiError(
      503,
      `Imagettes indisponibles : ${e instanceof Error ? e.message : "erreur inconnue"}`,
      { code: "unavailable" },
    );
  }
}

export const GET = safe(handleGET);
