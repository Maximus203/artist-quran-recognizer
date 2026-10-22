import { randomUUID } from "node:crypto";
import path from "node:path";
import { withLock } from "./lock";
import {
  REVIEW_SCHEMA,
  mergeAnnotations,
  reviewUpdateSchema,
  type Annotation,
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
 * Identité de celui qui enregistre : le compte connecté. Quand elle est fournie, le serveur — et non
 * le client — décide de l'auteur : `tester` d'un nouveau signalement = pseudonyme du compte, et on
 * ne modifie ni ne supprime le signalement d'un autre testeur (sauf administrateur).
 */
export type ReviewIdentity = { username: string; admin: boolean };

export type ReviewUpdate = { review: Review; rejected: string[] };

/** Applique l'identité aux signalements envoyés ; renvoie ce qui est retenu et ce qui est refusé. */
export function attribute(
  previous: readonly Annotation[],
  incoming: readonly Annotation[],
  deletedIds: readonly string[],
  who: ReviewIdentity,
): { annotations: Annotation[]; deletedIds: string[]; rejected: string[] } {
  const existing = new Map(previous.map((a) => [a.id, a]));
  const rejected: string[] = [];
  const mayEdit = (current: Annotation) =>
    who.admin || current.tester === who.username;
  const annotations: Annotation[] = [];
  for (const next of incoming) {
    const current = existing.get(next.id);
    if (!current) {
      // Nouveau : l'auteur est le compte connecté, jamais ce que le client prétend.
      const { updated_by: _ignored, ...rest } = next;
      annotations.push({ ...rest, tester: who.username });
    } else if (mayEdit(current)) {
      const { updated_by: _ignored, ...rest } = next;
      annotations.push({
        ...rest,
        tester: current.tester,
        ...(current.tester === who.username
          ? {}
          : { updated_by: who.username }),
      });
    } else rejected.push(next.id);
  }
  const allowedDeletes = deletedIds.filter((id) => {
    const current = existing.get(id);
    if (!current || mayEdit(current)) return true;
    rejected.push(id);
    return false;
  });
  return {
    annotations,
    deletedIds: allowedDeletes,
    rejected: [...new Set(rejected)],
  };
}

/**
 * Enregistre les signalements d'un testeur dans la revue d'une session, en les FUSIONNANT par
 * identifiant avec ceux des autres testeurs (voir `mergeAnnotations`). La lecture, la fusion et
 * l'écriture se font sous verrou : deux enregistrements simultanés ne s'écrasent pas. Renvoie la
 * revue fusionnée, pour que le client retrouve ce que les autres ont signalé.
 */
export function updateReview(
  id: string,
  body: unknown,
  who?: ReviewIdentity,
): Promise<Review> {
  return updateReviewAs(id, body, who).then((update) => update.review);
}

export function updateReviewAs(
  id: string,
  body: unknown,
  who?: ReviewIdentity,
): Promise<ReviewUpdate> {
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
    const prior = previous?.annotations ?? [];
    const accepted = who
      ? attribute(prior, input.annotations, input.deleted_ids, who)
      : {
          annotations: input.annotations,
          deletedIds: input.deleted_ids,
          rejected: [],
        };
    const annotations = mergeAnnotations(
      prior,
      accepted.annotations,
      accepted.deletedIds,
    );
    const merged: Review = {
      schema: REVIEW_SCHEMA,
      session_id: id,
      audio_sha256: session.audio_sha256,
      prediction_sha256: session.prediction_sha256,
      annotations,
      updated_at: new Date().toISOString(),
    };
    if (
      previous &&
      JSON.stringify(previous.annotations) === JSON.stringify(annotations)
    )
      return { review: previous, rejected: accepted.rejected };
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
    return { review: merged, rejected: accepted.rejected };
  });
}
