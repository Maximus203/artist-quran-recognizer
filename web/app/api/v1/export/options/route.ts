import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_CONTENTS,
  EXPORT_FONTS,
  EXPORT_FORMATS,
  EXPORT_FORMULAS,
  EXPORT_POLICIES,
  EXPORT_REPETITIONS,
} from "@/lib/export-options";
import { json, safe } from "@/lib/http";
import { requireUser } from "@/lib/route-guard";
import { videoOptionsCatalog } from "@/lib/video-job-options";
export const runtime = "nodejs";

/**
 * Catalogue des options d'export, pour qu'une application ou un agent sache quoi demander :
 * sous-titres (`POST …/export/subtitles`, corps `{ options }`) et vidéo
 * (`POST …/export/video/jobs`, corps `{ options }`), avec valeurs permises et défauts.
 */
async function handleGET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  return json({
    subtitles: {
      endpoint: "POST /api/v1/recordings/{id}/export/subtitles",
      options: {
        format: EXPORT_FORMATS,
        content: EXPORT_CONTENTS,
        formulas: { items: EXPORT_FORMULAS, max: 4 },
        repetitions: EXPORT_REPETITIONS,
        min_s: { min: 0, max: 30 },
        max_s: { min: 0.5, max: 60 },
        line_chars: { min: 10, max: 200 },
        offset_ms: { min: -5000, max: 5000 },
        rtl: "boolean",
        strip_notes: "boolean",
        show_ref: "boolean",
        bom: "boolean",
        karaoke: "boolean (ASS : surlignage mot à mot)",
        font: EXPORT_FONTS,
        policy: EXPORT_POLICIES,
        allow_unresolved: "boolean",
      },
      defaults: DEFAULT_EXPORT_OPTIONS,
    },
    video: {
      endpoint: "POST /api/v1/recordings/{id}/export/video/jobs",
      status: "GET /api/v1/recordings/{id}/export/video/jobs/{job}",
      file: "GET /api/v1/recordings/{id}/export/video/jobs/{job}/file",
      ...videoOptionsCatalog(),
    },
  });
}

export const GET = safe(handleGET);
