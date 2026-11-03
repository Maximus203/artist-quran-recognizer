import { z } from "zod";
import {
  clipFailure,
  clipRoute,
  type ClipParams,
} from "@/lib/background-video-http";
import { completeClip } from "@/lib/background-video-store";
import { apiError, json, safe } from "@/lib/http";
import { readBoundedBody } from "@/lib/read-bounded";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z
  .object({
    sha256: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/)
      .optional(),
  })
  .strict();

/**
 * Fin de l'envoi : assemble les morceaux, vérifie le type RÉEL du fichier (pas son extension), puis lance la
 * préparation sur le serveur (image seule, H.264). Répond `202` avec l'état `processing` : suivre `GET …/<id>`
 * jusqu'à `ready`. Corps facultatif `{ sha256 }` : empreinte du fichier entier. `409` s'il manque des morceaux.
 * Redemander après coup rend l'état (réponse perdue).
 */
async function handlePOST(
  request: Request,
  { params }: { params: ClipParams },
) {
  const route = await clipRoute(request, params, { mutation: true });
  if (!route.ok) return route.response;
  const raw = await readBoundedBody(request, 4096);
  if (raw === null)
    return apiError(413, "Corps trop gros.", { code: "too_big" });
  let options: z.infer<typeof schema> = {};
  if (raw.length > 0) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString("utf8"));
    } catch {
      return apiError(400, "JSON invalide.", { code: "invalid" });
    }
    const checked = schema.safeParse(parsed);
    if (!checked.success)
      return apiError(400, "Corps attendu : { sha256? }.", { code: "invalid" });
    options = checked.data;
  }
  try {
    const clip = await completeClip(route.ctx, undefined, {
      sha256: options.sha256 ?? null,
    });
    return json(clip, clip.state === "processing" ? 202 : 200);
  } catch (error) {
    return clipFailure(error);
  }
}

export const POST = safe(handlePOST);
