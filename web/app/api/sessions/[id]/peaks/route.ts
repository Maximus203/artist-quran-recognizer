import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { audioPath, sessionDir } from "@/lib/store";
import { ensureListening } from "@/lib/listening";
import { sessionAccess } from "@/lib/route-guard";
export const runtime = "nodejs";
/** Crêtes de la copie d'écoute (`aqr.listening-peaks/1`) : la forme d'onde sans décoder l'audio. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  try {
    const id = access.id;
    const files = await ensureListening(sessionDir(id), await audioPath(id));
    return new Response(await readFile(files.peaks), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "private, no-store",
      },
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
