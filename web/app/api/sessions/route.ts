import { NextRequest, NextResponse } from "next/server";
import {
  ImportError,
  importFromBytes,
  importFromStream,
} from "@/lib/import-session";
import { ensureQueueRecovered, launch } from "@/lib/jobs";
import { isLocalRequest } from "@/lib/local-request";
import { listSessionViews, readSessionView } from "@/lib/session-view";
import {
  cleanupSessions,
  exceedsUploadLimit,
  sessionTtlSeconds,
  uploadLimitBytes,
} from "@/lib/store";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  await ensureQueueRecovered().catch(() => []);
  return NextResponse.json(await listSessionViews());
}

/**
 * Import d'un audio ou d'une vidéo.
 *
 * - Flux brut (recommandé, seul adapté à une vidéo volumineuse) : corps = octets du fichier,
 *   en-tête `x-aqr-filename` (nom encodé en pourcentage), `x-aqr-source-kind` facultatif.
 * - Formulaire multipart (champ `audio`, résultat `result` facultatif) : lu en mémoire, audio seulement
 *   dans la pratique (plafond `AQR_MAX_UPLOAD_BYTES`).
 * `?autorun=1` (ou le champ `autorun=1` du formulaire) met l'analyse en file dès l'import.
 */
export async function POST(request: NextRequest) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    await cleanupSessions(sessionTtlSeconds()).catch(() => []);
    let autorun = new URL(request.url).searchParams.get("autorun") === "1";
    const multipart = (request.headers.get("content-type") ?? "")
      .toLowerCase()
      .startsWith("multipart/form-data");
    let created;
    if (multipart) {
      if (
        exceedsUploadLimit(
          request.headers.get("content-length"),
          uploadLimitBytes(),
        )
      )
        return NextResponse.json(
          { error: "Envoi trop volumineux." },
          { status: 413 },
        );
      const form = await request.formData();
      const file = form.get("audio") ?? form.get("media");
      if (!(file instanceof File))
        return NextResponse.json(
          { error: "Choisis un audio ou une vidéo." },
          { status: 400 },
        );
      const imported = form.get("result");
      const kind = form.get("source_kind");
      autorun = autorun || form.get("autorun") === "1";
      created = await importFromBytes({
        name: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
        sourceKind: typeof kind === "string" ? kind : null,
        prediction:
          imported instanceof File && imported.size
            ? Buffer.from(await imported.arrayBuffer())
            : null,
      });
    } else {
      if (!request.body)
        return NextResponse.json(
          { error: "Corps de requête vide." },
          { status: 400 },
        );
      created = await importFromStream({
        stream: request.body,
        filename: request.headers.get("x-aqr-filename"),
        sourceKind: request.headers.get("x-aqr-source-kind"),
        contentLength: request.headers.get("content-length"),
      });
    }
    // Un échec de mise en file ne perd pas l'import : la session reste « prête » et le dit.
    let autorunError: string | null = null;
    if (autorun && created.state === "ready") {
      try {
        await ensureQueueRecovered();
        await launch(created.id);
      } catch (e) {
        autorunError =
          e instanceof Error ? e.message : "Mise en file impossible";
      }
    }
    return NextResponse.json(
      {
        ...(await readSessionView(created.id)),
        ...(autorunError ? { autorun_error: autorunError } : {}),
      },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof ImportError)
      return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import impossible" },
      { status: 400 },
    );
  }
}
