import { optionIssuesFr } from "@/lib/video-option-errors";
import { clipFailure } from "@/lib/background-video-http";
import { readyClip } from "@/lib/background-video-store";
import { apiError, json, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { readSession } from "@/lib/store";
import {
  BrowserUnavailableError,
  jobsForSession,
  renderOrigin,
  publicJob,
  startVideoJob,
  VideoJobLimitError,
} from "@/lib/video-jobs";
import { clipUploadIdOf, videoJobOptionsSchema } from "@/lib/video-job-options";
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
  let reuse = true;
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  try {
    if (type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      const field = form.get("options");
      raw = typeof field === "string" && field ? JSON.parse(field) : {};
      reuse = form.get("reuse") !== "0";
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
      if (raw && typeof raw === "object" && "reuse" in raw)
        reuse = (raw as { reuse?: unknown }).reuse !== false;
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
  // Vidéo de fond choisie : elle doit être celle de CE compte, pour CETTE session, et prête (sinon « inconnue »,
  // 404, comme pour toute ressource d'autrui). Une image envoyée en même temps est ambiguë : refusée.
  const clipId = clipUploadIdOf(parsed.data.background);
  let clip: { path: string; sha256: string } | null = null;
  if (clipId) {
    if (background)
      return apiError(
        400,
        "Choisis une image de fond OU une vidéo de fond, pas les deux.",
        { code: "invalid", field: "background" },
      );
    try {
      const ready = await readyClip({
        id: clipId,
        sessionId: access.id,
        ownerId: access.user.id,
      });
      clip = { path: ready.path, sha256: ready.sha256 };
    } catch (error) {
      return clipFailure(error);
    }
  }
  // Par l'API : le jeton de l'appelant. Depuis l'atelier : sa connexion (cookies), pour que l'export
  // continue sur le serveur même si la page est quittée.
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const cookie = request.headers.get("cookie");
  const credential = bearer ? { bearer } : cookie ? { cookie } : null;
  if (!credential)
    return apiError(
      401,
      "Un export vidéo demande une connexion (cookie) ou un jeton (Authorization: Bearer qtr_…).",
      { code: "token_required" },
    );
  try {
    const job = await startVideoJob({
      sessionId: access.id,
      userId: access.user.id,
      options: parsed.data,
      background,
      clip,
      credential,
      origin: renderOrigin(),
      reuse,
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

/** Exports de cette session en file, en cours ou terminés depuis moins d'une heure, pour CE compte (l'administrateur voit ceux de tous). */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  const admin = access.user.role === "admin";
  return json({
    jobs: jobsForSession(access.id, admin ? null : access.user.id),
  });
}

export const POST = safe(handlePOST);
export const GET = safe(handleGET);
