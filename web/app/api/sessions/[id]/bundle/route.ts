import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import path from "node:path";
import { NextResponse } from "next/server";
import { REPO, readSession, sessionDir } from "@/lib/store";
import { isLocalRequest } from "@/lib/local-request";
export const runtime = "nodejs";
const exec = promisify(execFile);
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const { id } = await params;
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
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Pack impossible" },
      { status: 400 },
    );
  }
}
