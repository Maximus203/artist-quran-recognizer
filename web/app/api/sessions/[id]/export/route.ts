import { NextResponse } from "next/server";
import {
  readResult,
  readReview,
  readReviewHistory,
  readSession,
} from "@/lib/store";
import { isLocalRequest } from "@/lib/local-request";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const { id } = await params,
      session = await readSession(id),
      result = await readResult(id),
      review = await readReview(id),
      history = await readReviewHistory(id);
    const pack = {
      schema: "aqr.review-pack/1",
      exported_at: new Date().toISOString(),
      session: {
        id,
        audio_sha256: session.audio_sha256,
        audio_name: session.name,
        audio_size: session.size,
        audio_url: `/api/sessions/${id}/audio`,
        storage: "local-only",
      },
      prediction: result
        ? {
            sha256: session.prediction_sha256,
            original_json: result.raw.toString("utf8"),
          }
        : null,
      review,
      review_history: history,
      evaluation: {
        state: "unavailable",
        reason:
          "Une revue partielle ne constitue pas une vérité terrain complète relue.",
      },
    };
    return new Response(JSON.stringify(pack, null, 2) + "\n", {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="aqr-review-${id}.json"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return NextResponse.json({ error: "Export impossible" }, { status: 404 });
  }
}
