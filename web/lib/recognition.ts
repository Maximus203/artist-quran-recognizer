import { z } from "zod";

const finite = z.number().finite();
const hash = z.string().regex(/^[a-f0-9]{64}$/i);
const span = z
  .tuple([finite.nonnegative(), finite.nonnegative()])
  .refine(([a, b]) => b > a);
const ref = z.string().regex(/^(?:[1-9]|[1-9]\d|1(?:0\d|1[0-4])):[1-9]\d*$/);
const translation = z.object({
  text: z.string(),
  translation_id: z.string(),
  version: z.string(),
  attribution: z.string(),
  scope: z.literal("verse"),
});
const verse = z
  .object({
    kind: z.literal("verse"),
    ref: ref.nullable(),
    words: z
      .tuple([z.number().int().positive(), z.number().int().positive()])
      .nullable(),
    partial: z.boolean(),
    status: z.enum(["recognized", "inferred", "uncertain"]),
    t: span.nullable(),
    time_interpolated: z.boolean(),
    confidence: finite,
    candidates: z.array(ref),
    repetition: z.boolean(),
    text: z.string().nullish(),
    translation: translation.nullish(),
  })
  .refine(
    (v) =>
      v.status === "uncertain" ? !v.text && !v.translation : v.ref !== null,
    "Statut et texte incohérents",
  );
const nonQuran = z.object({
  kind: z.literal("non_quran"),
  label: z.string(),
  t: span,
});
const abstention = z.object({
  kind: z.literal("abstention"),
  reason: z.enum([
    "silence",
    "empty_transcript",
    "no_candidate",
    "below_threshold",
  ]),
  t: span,
  best_score: finite.nullable(),
});
const interval = z.discriminatedUnion("kind", [verse, nonQuran, abstention]);
export const recognitionSchema = z
  .object({
    schema: z.literal("aqr.recognition/1"),
    source: z.object({
      file: z.string(),
      sha256: hash,
      duration_s: finite.positive(),
    }),
    engine: z.object({
      asr: z.string(),
      segmenter: z.string(),
      matcher: z.string(),
      decoder: z.string(),
      constrained: z.boolean(),
      corpus: z.string(),
    }),
    decoder: z.record(z.string(), finite),
    timing: z.record(z.string(), finite),
    windows: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
    intervals: z.array(interval),
  })
  .superRefine((doc, ctx) => {
    doc.intervals.forEach((item, index) => {
      if (item.t && item.t[1] > doc.source.duration_s + 0.01)
        ctx.addIssue({
          code: "custom",
          message: `Intervalle ${index} hors audio`,
        });
      if (item.kind === "verse" && item.words && item.words[1] < item.words[0])
        ctx.addIssue({ code: "custom", message: `Mots inversés ${index}` });
    });
  });
export type Recognition = z.infer<typeof recognitionSchema>;
export type Interval = Recognition["intervals"][number];
export function parseRecognition(input: unknown): Recognition {
  return recognitionSchema.parse(input);
}
export function activeIntervals(
  intervals: Interval[],
  time: number,
): Interval[] {
  return intervals.filter((i) => i.t && i.t[0] <= time && time < i.t[1]);
}
export function formatTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000),
    m = Math.floor(ms / 60000) % 60,
    s = Math.floor(ms / 1000) % 60;
  return `${h ? String(h).padStart(2, "0") + ":" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
