import { readiness } from "@/lib/export-engine";
import { exportErrorResponse } from "@/lib/export-errors";
import { resolveExportOptions } from "@/lib/export-options";
import { json, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
import { viewForUser } from "@/lib/session-service";
export const runtime = "nodejs";

const flag = (value: string | null): boolean | undefined =>
  value === null ? undefined : value === "1" || value === "true";
const count = (value: string | null, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

/**
 * « Prêt à exporter ? » : le décompte et UNE page des passages ambigus de la partie coranique
 * (10 par défaut, 50 au plus), calculés par le moteur avec les décisions appliquées. Elle dépend de ce
 * qu'on exporte : `content` (`ar_fr` · `ar` · `fr`), `ref=1` (référence affichée), `strip=1`. Une
 * session de 3 000 intervalles ne renvoie jamais ses 3 000 intervalles. Tout lecteur de la session
 * peut la lire ; 404 pour l'audio privé d'un autre ; 409 `not_ready` tant que l'analyse n'est pas finie.
 * `state` (`open` · `resolved` · `ignored`) filtre les passages ; `session` donne le nom, les droits et les durées.
 */
async function handleGET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const access = await sessionAccess(request, params, "view");
  if (!access.ok) return access.response;
  try {
    const query = new URL(request.url).searchParams;
    const options = resolveExportOptions({
      ...(query.get("content") ? { content: query.get("content") } : {}),
      ...(flag(query.get("ref")) !== undefined
        ? { show_ref: flag(query.get("ref")) }
        : {}),
      ...(flag(query.get("strip")) !== undefined
        ? { strip_notes: flag(query.get("strip")) }
        : {}),
    });
    const payload = (await readiness(access.id, options, {
      page: count(query.get("page"), 0),
      size: Math.min(50, count(query.get("size"), 10)),
      type: query.get("type"),
      state: query.get("state"),
    })) as Record<string, unknown>;
    // Ce que la page affiche de la session (nom, droits, durées) : jamais son résultat.
    const view = await viewForUser(access.db, access.user, access.meta);
    return json({
      ...payload,
      session: view && {
        id: view.id,
        name: view.name,
        state: view.state,
        can_edit: view.can_edit,
        mine: view.mine,
        visibility: view.visibility,
        audio_duration_s: view.audio_duration_s ?? null,
        duration_s: view.duration_s ?? null,
        owner: view.owner,
      },
    });
  } catch (error) {
    return exportErrorResponse(error) ?? Promise.reject(error);
  }
}

export const GET = safe(handleGET);
