import { readFile } from "node:fs/promises";
import { apiError, json, safe } from "@/lib/http";
import { isVideoContainer, ensureListening } from "@/lib/listening";
import { sessionAccess } from "@/lib/route-guard";
import { audioPath, readResult, readSession, sessionDir } from "@/lib/store";
import {
  findSilences,
  suggestionNotes,
  suggestRanges,
  type SuggestPeaks,
} from "@/lib/export-video-suggest";
import { suggestOptionsFromQuery } from "@/lib/video-job-options";
export const runtime = "nodejs";

/**
 * Plages à exporter, déjà protégées : une par verset (ou par passage), qui commencent un peu avant
 * la récitation et finissent un peu après, aimantées au silence le plus proche, pour qu'aucune
 * vidéo ne coupe une voix. Paramètres : `lead_in` et `tail_out` (secondes, 0 à 5), `snap`
 * (`1`/`0`), `group` (`verse` · `passage`), `merge_gap` (secondes), `silences=1` pour recevoir aussi
 * les silences de l'audio. Chaque plage donne `start`/`end` (à passer tels quels à l'export vidéo),
 * la récitation seule (`core_*`), les marges réellement gardées, les références, le statut de preuve
 * et d'éventuels avertissements. 409 tant que l'analyse n'est pas finie.
 */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  const session = await readSession(access.id);
  if (session.state !== "done")
    return apiError(409, "L'analyse n'est pas terminée.", {
      code: "not_ready",
    });
  const query = new URL(request.url).searchParams;
  const parsed = suggestOptionsFromQuery(query);
  if (!parsed.ok) return apiError(400, parsed.error, { code: "invalid" });
  const result = await readResult(access.id);
  if (!result) return apiError(409, "Aucun résultat.", { code: "not_ready" });
  let peaks: SuggestPeaks | null = null;
  try {
    const files = await ensureListening(
      sessionDir(access.id),
      await audioPath(access.id),
    );
    peaks = JSON.parse(await readFile(files.peaks, "utf8")) as SuggestPeaks;
  } catch {
    peaks = null; // sans onde : marges fixes, sans aimantation
  }
  const duration = peaks?.duration ?? result.parsed.source.duration_s;
  const ranges = suggestRanges(
    result.parsed.intervals,
    duration,
    peaks,
    parsed.options,
  );
  const silences = peaks ? findSilences(peaks) : [];
  return json({
    session: {
      id: access.id,
      kind: isVideoContainer(session.extension ?? "") ? "video" : "audio",
      duration,
    },
    options: {
      lead_in: parsed.options.leadIn,
      tail_out: parsed.options.tailOut,
      snap_to_silence: parsed.options.snapToSilence && peaks !== null,
      group: parsed.options.group,
      merge_gap: parsed.options.mergeGap,
    },
    ranges,
    silence_count: silences.length,
    ...(query.get("silences") === "1" ? { silences } : {}),
    notes: suggestionNotes(ranges),
    usage:
      'Passer `ranges` (start, end) à l\'export vidéo : POST …/export/video/jobs { ranges: [{start, end}, …] } (une vidéo par plage), ou demander directement `suggest: "verse" | "passage"` avec les mêmes marges.',
  });
}

export const GET = safe(handleGET);
