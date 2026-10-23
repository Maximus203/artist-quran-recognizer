import { readiness } from "@/lib/export-engine";
import { exportErrorResponse } from "@/lib/export-errors";
import { resolveExportOptions } from "@/lib/export-options";
import { json, safe } from "@/lib/http";
import { sessionAccess } from "@/lib/route-guard";
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
    return json(
      await readiness(access.id, options, {
        page: count(query.get("page"), 0),
        size: Math.min(50, count(query.get("size"), 10)),
        type: query.get("type"),
      }),
    );
  } catch (error) {
    return exportErrorResponse(error) ?? Promise.reject(error);
  }
}

export const GET = safe(handleGET);
