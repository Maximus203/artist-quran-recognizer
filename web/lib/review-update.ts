import { randomUUID } from "node:crypto";
import path from "node:path";
import { withLock } from "./lock";
import {
  REVIEW_SCHEMA,
  mergeAnnotations,
  reviewUpdateSchema,
  type Review,
} from "./review";
import {
  atomicJson,
  readResult,
  readReview,
  readSession,
  sessionDir,
} from "./store";

/**
 * Enregistre les signalements d'un testeur dans la revue d'une session, en les FUSIONNANT par
 * identifiant avec ceux des autres testeurs (voir `mergeAnnotations`). La lecture, la fusion et
 * l'écriture se font sous verrou : deux enregistrements simultanés ne s'écrasent pas. Renvoie la
 * revue fusionnée, pour que le client retrouve ce que les autres ont signalé.
 */
export function updateReview(id: string, body: unknown): Promise<Review> {
  return withLock(`review:${id}`, async () => {
    const session = await readSession(id);
    const input = reviewUpdateSchema.parse(body);
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

    const previous = await readReview(id);
    const annotations = mergeAnnotations(
      previous?.annotations ?? [],
      input.annotations,
      input.deleted_ids,
    );
    const merged: Review = {
      schema: REVIEW_SCHEMA,
      session_id: id,
      audio_sha256: session.audio_sha256,
      prediction_sha256: session.prediction_sha256,
      annotations,
      updated_at: new Date().toISOString(),
    };
    if (previous && JSON.stringify(previous.annotations) === JSON.stringify(annotations))
      return previous;
    if (previous)
      await atomicJson(
        path.join(
          sessionDir(id),
          "revisions",
          `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.review.json`,
        ),
        previous,
      );
    await atomicJson(path.join(sessionDir(id), "review.json"), merged);
    return merged;
  });
}
