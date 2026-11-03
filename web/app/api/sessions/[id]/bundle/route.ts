import { safe } from "@/lib/http";
import { log } from "@/lib/log";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import path from "node:path";
import { NextResponse } from "next/server";
import { REPO, readSession, sessionDir } from "@/lib/store";
import { sessionAccess } from "@/lib/route-guard";
export const runtime = "nodejs";
const exec = promisify(execFile);
/** Pack de revue (ZIP) d'une session : réservé aux testeurs qui la voient (privée : son propriétaire). */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  try {
    const id = access.id;
    await readSession(id);
    const output = path.join(sessionDir(id), "exports", `${randomUUID()}.zip`);
    await exec(
      process.env.AQR_PYTHON || "python",
      [
        path.join(REPO, "scripts", "export_review_bundle.py"),
        sessionDir(id),
        output,
      ],
      { cwd: REPO, windowsHide: true, timeout: 120000 },
    );
    const size = (await stat(output)).size;
    return new Response(
      Readable.toWeb(createReadStream(output)) as ReadableStream,
      {
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(size),
          "Content-Disposition": `attachment; filename="aqr-review-${id}.zip"`,
          "Cache-Control": "private, no-store",
        },
      },
    );
  } catch (error) {
    // Le message d'origine (sortie du script Python) peut citer des chemins : il va au journal, pas à l'appelant.
    log.error("export", "pack de revue impossible", error);
    return NextResponse.json(
      {
        error: "Pack impossible pour l'instant : réessaie dans un instant.",
        code: "bundle_failed",
      },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}

export const GET = safe(handleGET);
