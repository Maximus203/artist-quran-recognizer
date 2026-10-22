import { json } from "@/lib/http";
import { userQuotaBytes } from "@/lib/quota";
import { requireUser } from "@/lib/route-guard";
import { ownedTotals, userAnalysisStats } from "@/lib/session-index";
export const runtime = "nodejs";

/**
 * Statistiques du compte : nombre de tests (analyses terminées, y compris celles dont la session a
 * été supprimée depuis), heures d'audio analysées, facteur temps réel moyen, espace utilisé et
 * quota. Aucune donnée d'un autre utilisateur.
 */
export async function GET(request: Request) {
  const auth = await requireUser(request);
  if (!auth.ok) return auth.response;
  const analyses = userAnalysisStats(auth.db, auth.user.id);
  const owned = ownedTotals(auth.db, auth.user.id);
  const limit = userQuotaBytes();
  return json({
    tests: analyses.tests,
    failures: analyses.failures,
    audio_hours: analyses.audio_total_s / 3600,
    processing_hours: analyses.processing_total_s / 3600,
    rtf_mean: analyses.rtf_mean,
    by_engine: analyses.by_engine,
    sessions: {
      total: owned.sessions,
      private: owned.private_sessions,
      audio_hours: owned.audio_s / 3600,
    },
    storage: {
      used_bytes: owned.bytes,
      disk_bytes: owned.disk_bytes,
      limit_bytes: limit || null,
      remaining_bytes: limit ? Math.max(0, limit - owned.bytes) : null,
    },
  });
}
