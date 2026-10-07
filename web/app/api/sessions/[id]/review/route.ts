import { randomUUID } from "node:crypto";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  atomicJson,
  readResult,
  readReview,
  readSession,
  sessionDir,
} from "@/lib/store";
import { reviewSchema } from "@/lib/review";
import { isLocalRequest } from "@/lib/local-request";
export const runtime = "nodejs";
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const { id } = await params,
      session = await readSession(id);
    const previous = await readReview(id);
    const input = reviewSchema.parse(await request.json());
    if (
      input.session_id !== id ||
      input.audio_sha256 !== session.audio_sha256 ||
      input.prediction_sha256 !== session.prediction_sha256
    )
      throw new Error("La revue ne correspond pas à cet audio ou résultat.");
    const result = await readResult(id);
    const limit =
      result?.parsed.source.duration_s ??
      Number(process.env.AQR_MAX_REVIEW_SECONDS || 86400);
    if (
      input.annotations.some(
        (a) => a.start_s > limit || (a.end_s !== null && a.end_s > limit),
      )
    )
      throw new Error("Temps hors durée audio");
    if (
      previous &&
      JSON.stringify(previous.annotations) !== JSON.stringify(input.annotations)
    )
      await atomicJson(
        path.join(
          sessionDir(id),
          "revisions",
          `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.review.json`,
        ),
        previous,
      );
    await atomicJson(path.join(sessionDir(id), "review.json"), input);
    return NextResponse.json({ saved: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Sauvegarde impossible" },
      { status: 400 },
    );
  }
}
