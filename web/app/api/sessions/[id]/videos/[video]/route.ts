import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { apiError, json, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { refreshDiskBytes } from "@/lib/session-sync";
import { deleteVideo, parseRange, videoFile } from "@/lib/video-library";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; video: string }> };
const sessionParams = (params: Ctx["params"]) =>
  params as Promise<{ id: string }>;

/**
 * Lit une vidéo gardée sur le serveur : lecture dans la page (plages d'octets prises en charge, pour
 * avancer dans la vidéo) ou téléchargement avec `?download=1`.
 */
async function handleGET(request: Request, { params }: Ctx) {
  const access = await sessionAccess(request, sessionParams(params), "view");
  if (!access.ok) return access.response;
  const file = await videoFile(access.id, (await params).video);
  if (!file) return apiError(404, "Vidéo introuvable.");
  const download = new URL(request.url).searchParams.get("download") === "1";
  const name = file.record?.name ?? "video.mp4";
  const headers: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="video.mp4"; filename*=UTF-8''${encodeURIComponent(name)}`,
  };
  const asked = request.headers.get("range");
  if (asked) {
    const range = parseRange(asked, file.bytes);
    if (!range)
      return new Response(null, {
        status: 416,
        headers: { ...headers, "Content-Range": `bytes */${file.bytes}` },
      });
    const [start, end] = range;
    return new Response(
      Readable.toWeb(
        createReadStream(file.path, { start, end }),
      ) as ReadableStream,
      {
        status: 206,
        headers: {
          ...headers,
          "Content-Range": `bytes ${start}-${end}/${file.bytes}`,
          "Content-Length": String(end - start + 1),
        },
      },
    );
  }
  return new Response(
    Readable.toWeb(createReadStream(file.path)) as ReadableStream,
    { headers: { ...headers, "Content-Length": String(file.bytes) } },
  );
}

/** Supprime une vidéo (libère l'espace) : le propriétaire de l'enregistrement ou un administrateur. */
async function handleDELETE(request: Request, { params }: Ctx) {
  const access = await sessionAccess(request, sessionParams(params), "edit", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  const removed = await deleteVideo(access.id, (await params).video);
  if (!removed) return apiError(404, "Vidéo introuvable.");
  await refreshDiskBytes(access.db, access.id);
  return json({ deleted: true });
}

export const GET = safe(handleGET);
export const DELETE = safe(handleDELETE);
