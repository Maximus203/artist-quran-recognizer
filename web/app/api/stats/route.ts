import { NextResponse } from "next/server";
import { ensureQueueRecovered } from "@/lib/jobs";
import { isLocalRequest } from "@/lib/local-request";
import { readStats } from "@/lib/session-view";
export const runtime = "nodejs";
/**
 * Performance du moteur d'après les sessions déjà sur le disque : par moteur, nombre d'analyses,
 * facteur temps réel (médiane, p90, moyenne), durées totales et modèle d'estimation ; file courante
 * et dernières analyses. Calcul pur, aucune donnée nouvelle.
 */
export async function GET(request: Request) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  await ensureQueueRecovered().catch(() => []);
  return NextResponse.json(await readStats(), {
    headers: { "Cache-Control": "no-store" },
  });
}
