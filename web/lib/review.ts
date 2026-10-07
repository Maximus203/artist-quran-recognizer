import { z } from "zod";

export const annotationSchema = z
  .object({
    id: z.string().uuid(),
    mode: z.enum(["point", "range"]),
    start_s: z.number().finite().nonnegative(),
    end_s: z.number().finite().nonnegative().nullable(),
    type: z.enum([
      "wrong_verse",
      "missing_verse",
      "repetition",
      "timing",
      "other",
    ]),
    description: z.string().max(3000),
    expected_ref: z
      .string()
      .regex(/^\d{1,3}:\d{1,3}$/)
      .nullable(),
    target_index: z.number().int().nonnegative().nullable(),
    status: z.enum(["draft", "confirmed"]),
    updated_at: z.string().datetime(),
  })
  .superRefine((a, ctx) => {
    if (a.mode === "range" && (a.end_s === null || a.end_s <= a.start_s))
      ctx.addIssue({ code: "custom", message: "Plage invalide" });
  });
export const reviewSchema = z.object({
  schema: z.literal("aqr.review/1"),
  session_id: z.string().uuid(),
  audio_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  prediction_sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  annotations: z.array(annotationSchema),
  updated_at: z.string().datetime(),
});
export type Annotation = z.infer<typeof annotationSchema>;
export type Review = z.infer<typeof reviewSchema>;
