import { z } from "zod";
import { exportSubtitles, previewSubtitles } from "@/lib/export-engine";
import { exportErrorResponse } from "@/lib/export-errors";
import { resolveExportOptions } from "@/lib/export-options";
import { json, readJson, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
export const runtime = "nodejs";

const body = z
  .object({
    options: z.record(z.string(), z.unknown()).optional(),
    name: z.string().max(200).optional(),
    preview: z.boolean().optional(),
    cues: z.number().int().min(1).max(10).optional(),
  })
  .strict();

/**
 * Les sous-titres d'une session : SRT, WebVTT, ASS (karaoké mot à mot quand les temps des mots sont
 * mesurés) ou JSON. Corps : `{ options, name?, preview?, cues? }` (options : voir
 * `lib/export-options.ts`). Sans `allow_unresolved`, des passages ambigus non résolus répondent
 * `409 unresolved_items` (la ligne de commande répond le code 3) ; avec, ils suivent la politique
 * (omettre par défaut) et le résumé porte `forced` et `unresolved`. `preview: true` ne livre rien : le
 * résumé et les premiers sous-titres (réponse `{ summary }`). Sinon `{ summary, name, mime, content }` ;
 * `?raw=1` répond le fichier en pièce jointe (résumé en base64 dans `X-Aqr-Summary`).
 * Route nouvelle : `GET …/export` (bilan JSON) existe déjà et n'est pas détournée.
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  try {
    const input = body.parse((await readJson(request)) ?? {});
    const options = resolveExportOptions(input.options);
    if (input.preview)
      return json({
        summary: await previewSubtitles(access.id, options, input.cues ?? 3),
      });
    const file = await exportSubtitles(access.id, options, input.name);
    if (new URL(request.url).searchParams.get("raw") === "1")
      return new Response(file.content, {
        headers: {
          "Content-Type": file.mime,
          "Content-Disposition": `attachment; filename="export.${options.format}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "X-Aqr-Summary": Buffer.from(JSON.stringify(file.summary)).toString(
            "base64",
          ),
          "Cache-Control": "private, no-store",
        },
      });
    return json(file);
  } catch (error) {
    return exportErrorResponse(error) ?? Promise.reject(error);
  }
}

export const POST = safe(handlePOST);
