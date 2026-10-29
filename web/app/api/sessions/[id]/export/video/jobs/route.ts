import { optionIssuesFr } from "@/lib/video-option-errors";
import { apiError, json, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { readSession } from "@/lib/store";
import {
  BrowserUnavailableError,
  publicJob,
  startVideoJob,
  VideoJobLimitError,
} from "@/lib/video-jobs";
import { videoJobOptionsSchema } from "@/lib/video-job-options";
export const runtime = "nodejs";

const MAX_BACKGROUND_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/**
 * Demande d'export vidéo par l'API : même rendu que le formulaire de l'atelier, fait par un
 * navigateur sans interface côté serveur. Corps JSON (`{ options }` ou directement les options)
 * ou multipart (`options` en JSON + `background_image` PNG/JPEG/WebP). Répond `202` avec le job ;
 * l'avancement se lit sur `…/jobs/{job}`, la vidéo sur `…/jobs/{job}/file`. Options : voir
 * `GET /api/v1/export/options`.
 */
async function handlePOST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view", {
    mutation: true,
  });
  if (!access.ok) return access.response;
  const session = await readSession(access.id);
  if (session.state !== "done")
    return apiError(409, "L'analyse n'est pas terminée.", {
      code: "not_ready",
    });

  let raw: unknown = {};
  let background: { bytes: Buffer; type: string } | null = null;
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  try {
    if (type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const field = form.get("options");
      raw = typeof field === "string" && field ? JSON.parse(field) : {};
      const file = form.get("background_image");
      if (file instanceof File && file.size > 0) {
        if (!IMAGE_TYPES.includes(file.type))
          return apiError(400, "background_image : PNG, JPEG ou WebP.", {
            code: "invalid",
            field: "background_image",
          });
        if (file.size > MAX_BACKGROUND_BYTES)
          return apiError(413, "background_image : 20 Mo au plus.", {
            code: "too_large",
          });
        background = {
          bytes: Buffer.from(await file.arrayBuffer()),
          type: file.type,
        };
      }
    } else {
      const text = await request.text();
      raw = text ? JSON.parse(text) : {};
    }
  } catch {
    return apiError(400, "Corps JSON invalide.", { code: "invalid" });
  }
  const candidate =
    raw && typeof raw === "object" && "options" in raw
      ? (raw as { options: unknown }).options
      : raw;
  const parsed = videoJobOptionsSchema.safeParse(candidate ?? {});
  if (!parsed.success)
    return apiError(
      400,
      `Options invalides : ${optionIssuesFr(parsed.error.issues)}.`,
      { code: "invalid" },
    );
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!bearer)
    return apiError(
      401,
      "L'export vidéo par l'API demande un jeton (Authorization: Bearer qtr_…).",
      { code: "token_required" },
    );
  try {
    const job = await startVideoJob({
      sessionId: access.id,
      userId: access.user.id,
      options: parsed.data,
      background,
      bearer,
      origin: new URL(request.url).origin,
    });
    return json({ job: publicJob(job) }, 202);
  } catch (error) {
    if (error instanceof VideoJobLimitError)
      return apiError(429, error.message, { code: "rate_limited" });
    if (error instanceof BrowserUnavailableError)
      return apiError(503, error.message, { code: "browser_unavailable" });
    throw error;
  }
}

export const POST = safe(handlePOST);
