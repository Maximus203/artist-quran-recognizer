import { safe } from "@/lib/http";
import { readFile, stat } from "node:fs/promises";
import { matchesEtag, weakEtag } from "@/lib/http-cache";
import { NextResponse } from "next/server";
import { audioPath, sessionDir } from "@/lib/store";
import { ensureListening } from "@/lib/listening";
import { sessionAccess } from "@/lib/route-guard";
export const runtime = "nodejs";
/** Crêtes de la copie d'écoute (`aqr.listening-peaks/1`) : la forme d'onde sans décoder l'audio. */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  try {
    const id = access.id;
    const files = await ensureListening(sessionDir(id), await audioPath(id));
    // Les crêtes ne changent que si l'audio change : le navigateur revalide (304, sans corps) au lieu
    // de retélécharger 2,3 Mo à chaque ouverture. `private` : jamais dans un cache partagé.
    const info = await stat(files.peaks);
    const etag = weakEtag(info.size, info.mtimeMs);
    const headers = {
      ETag: etag,
      "Cache-Control": "private, no-cache",
    };
    if (matchesEtag(request.headers.get("if-none-match"), etag))
      return new Response(null, { status: 304, headers });
    return new Response(await readFile(files.peaks), {
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: `Copie d'écoute indisponible : ${e instanceof Error ? e.message : "erreur inconnue"}`,
      },
      { status: 503 },
    );
  }
}

export const GET = safe(handleGET);
