import { z } from "zod";
import { legacyTypeOf } from "./review-presets";
import { LEGACY_TESTER, TESTER_PATTERN } from "./tester";

/**
 * Revue humaine : `aqr.review/2`. La v1 se lit encore (migration à la lecture, voir
 * `migrateReviewInput`) ; on n'écrit plus que la v2. Une revue réunit les signalements de PLUSIEURS
 * testeurs : chacun porte son `tester`, et le serveur fusionne par identifiant (`mergeAnnotations`).
 */
export const REVIEW_SCHEMA = "aqr.review/2";
const LEGACY_SCHEMA = "aqr.review/1";
const MAX_TAGS = 30;
const MAX_DELETED = 500;

const legacyType = z.enum([
  "wrong_verse",
  "missing_verse",
  "repetition",
  "timing",
  "other",
]);
const tagId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/);

export const annotationSchema = z
  .object({
    id: z.string().uuid(),
    mode: z.enum(["point", "range"]),
    start_s: z.number().finite().nonnegative(),
    end_s: z.number().finite().nonnegative().nullable(),
    /** Puces choisies (ids de `REVIEW_PRESETS`) ; un id inconnu s'affiche tel quel. */
    tags: z
      .array(tagId)
      .max(MAX_TAGS)
      .refine((tags) => new Set(tags).size === tags.length, "Puce en double"),
    /** Type historique d'aqr.review/1, dérivé du premier tag (exports inchangés). */
    type: legacyType,
    description: z.string().max(3000),
    expected_ref: z
      .string()
      .regex(/^\d{1,3}:\d{1,3}$/)
      .nullable(),
    target_index: z.number().int().nonnegative().nullable(),
    status: z.enum(["draft", "confirmed"]),
    /** Pseudonyme du testeur, copié à la création : le changer ensuite ne réécrit pas l'historique. */
    tester: z.string().regex(TESTER_PATTERN),
    /** Dernier testeur à avoir modifié ce signalement quand ce n'est pas son auteur. */
    updated_by: z.string().regex(TESTER_PATTERN).optional(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .superRefine((a, ctx) => {
    if (a.mode === "range" && (a.end_s === null || a.end_s <= a.start_s))
      ctx.addIssue({ code: "custom", message: "Plage invalide" });
    if (a.mode === "point" && a.end_s !== null)
      ctx.addIssue({ code: "custom", message: "Un point n'a pas de fin" });
    if (a.status === "confirmed" && !canConfirm(a))
      ctx.addIssue({
        code: "custom",
        message: "Choisis au moins une puce ou écris un commentaire.",
      });
  });

const reviewObject = z.object({
  schema: z.literal(REVIEW_SCHEMA),
  session_id: z.string().uuid(),
  audio_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  prediction_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  annotations: z.array(annotationSchema),
  updated_at: z.string().datetime(),
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Puce de remplacement pour chaque type historique d'aqr.review/1. */
const LEGACY_TAGS: Readonly<Record<string, string>> = {
  wrong_verse: "wrong_verse",
  missing_verse: "missing_verse",
  repetition: "repetition_missed",
  timing: "display_offset",
  other: "other",
};

function migrateAnnotationV1(value: unknown): unknown {
  if (!isRecord(value) || typeof value.type !== "string") return value;
  const tag = LEGACY_TAGS[value.type];
  if (!tag) return value; // type inconnu : le schéma v2 le refuse
  return {
    ...value,
    tags: [tag],
    tester: LEGACY_TESTER,
    created_at: value.updated_at,
  };
}

/** aqr.review/1 → /2 (lecture seule : le fichier d'origine n'est pas réécrit tant qu'on ne sauvegarde pas). */
export function migrateReviewInput(input: unknown): unknown {
  if (!isRecord(input) || input.schema !== LEGACY_SCHEMA) return input;
  return {
    ...input,
    schema: REVIEW_SCHEMA,
    annotations: Array.isArray(input.annotations)
      ? input.annotations.map(migrateAnnotationV1)
      : input.annotations,
  };
}

export const reviewSchema = z.preprocess(migrateReviewInput, reviewObject);

/** Corps d'un `PUT` : la revue du client (ses signalements) + les identifiants qu'il supprime. */
export const reviewUpdateSchema = z.preprocess(
  migrateReviewInput,
  reviewObject.extend({
    deleted_ids: z.array(z.string().uuid()).max(MAX_DELETED).default([]),
  }),
);

export type Annotation = z.infer<typeof annotationSchema>;
export type Review = z.infer<typeof reviewObject>;
export type ReviewUpdate = z.infer<typeof reviewUpdateSchema>;

/** Un signalement se confirme avec au moins une puce OU un commentaire non vide. */
export function canConfirm(a: {
  tags: readonly string[];
  description: string;
}): boolean {
  return a.tags.length > 0 || a.description.trim().length > 0;
}

/** Nouveau brouillon vide (un point si `end` est null). */
export function newAnnotation(input: {
  tester: string;
  start: number;
  end: number | null;
  targetIndex?: number | null;
  id?: string;
  now?: string;
}): Annotation {
  const now = input.now ?? new Date().toISOString();
  return {
    id: input.id ?? crypto.randomUUID(),
    mode: input.end === null ? "point" : "range",
    start_s: input.start,
    end_s: input.end,
    tags: [],
    type: "other",
    description: "",
    expected_ref: null,
    target_index: input.targetIndex ?? null,
    status: "draft",
    tester: input.tester,
    created_at: now,
    updated_at: now,
  };
}

const timeOf = (iso: string): number => {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
};

const withLegacyType = (a: Annotation): Annotation =>
  a.tags.length > 0 ? { ...a, type: legacyTypeOf(a.tags) } : a;

/**
 * Fusion par identifiant : plusieurs testeurs écrivent la même revue sans s'écraser.
 *  - un signalement absent de l'envoi reste tel quel (celui d'un autre testeur) ;
 *  - à identifiant égal, le dernier `updated_at` gagne (égalité : l'envoi) ;
 *  - `tester` et `created_at` ne changent jamais après la création ;
 *  - `deletedIds` retire les signalements (et l'emporte sur un envoi du même id).
 */
export function mergeAnnotations(
  existing: readonly Annotation[],
  incoming: readonly Annotation[],
  deletedIds: readonly string[],
): Annotation[] {
  const byId = new Map(existing.map((a) => [a.id, a]));
  for (const next of incoming) {
    const current = byId.get(next.id);
    if (!current) byId.set(next.id, withLegacyType(next));
    else if (timeOf(next.updated_at) >= timeOf(current.updated_at))
      byId.set(
        next.id,
        withLegacyType({
          ...next,
          tester: current.tester,
          created_at: current.created_at,
        }),
      );
  }
  for (const id of deletedIds) byId.delete(id);
  return [...byId.values()].sort(
    (a, b) =>
      a.start_s - b.start_s ||
      timeOf(a.created_at) - timeOf(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}
