import { getDb } from "@/lib/db";
import { freeBytes, minFreeBytes } from "@/lib/disk-space";
import { currentMode } from "@/lib/service-mode";
import { reviewRoot } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sonde de supervision (Uptime Kuma, répartiteur de charge) : publique, sans connexion, et sans rien
 * révéler d'exploitable (ni chemins, ni versions, ni chiffres). 200 si tout va bien, 503 si la base ne
 * répond pas, si le disque est sous sa réserve, ou si le service est en maintenance. Le détail (file,
 * mémoire, erreurs) est dans les journaux et `/api/queue`.
 */
export async function GET() {
  const problems: string[] = [];
  try {
    getDb().prepare("SELECT 1").get();
  } catch {
    problems.push("base");
  }
  const free = await freeBytes(reviewRoot());
  if (free !== null && free < minFreeBytes()) problems.push("disque");
  const mode = currentMode();
  if (mode === "maintenance") problems.push("maintenance");
  const ok = problems.length === 0;
  return Response.json(
    { status: ok ? "ok" : "degraded", mode, problems },
    {
      status: ok ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
