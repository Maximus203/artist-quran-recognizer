/**
 * Parole libre : transcription et traduction AUTOMATIQUES des passages arabes hors Coran
 * (`aqr.free-speech/1`, ADR-0027). Fichier séparé du résultat de reconnaissance : jamais présenté
 * comme le texte du Mushaf (I1) ni comme une traduction officielle (I2).
 *
 * Un passage retenu (`withheld`) ne porte aucun texte, seulement sa raison : il pourrait être
 * coranique (I3). La lecture du fichier est stricte sur ce point : un texte sur un passage retenu
 * invalide tout le fichier, qui est alors ignoré.
 */
import { z } from "zod";

export const FREE_SPEECH_SCHEMA = "aqr.free-speech/1";

export const FREE_SPEECH_NOTICE =
  "Transcription et traduction automatiques, hors Coran : approximatives, à vérifier.";

/**
 * Un intervalle du résultat que la parole libre peut concerner : une zone `arabic_speech`, ou une
 * abstention `no_candidate` (aucun verset ne ressemble au passage). `below_threshold` et un transcript
 * vide restent tels quels : c'est peut-être du Coran. Même règle que `freespeech/service.py`.
 */
export function isFreeSpeechCandidate(item: {
  kind: string;
  label?: string;
  reason?: string;
}): boolean {
  return item.kind === "non_quran"
    ? item.label === "arabic_speech"
    : item.kind === "abstention" && item.reason === "no_candidate";
}

export const FREE_SPEECH_REVIEWS = ["pending", "approved", "rejected"] as const;
export type FreeSpeechReview = (typeof FREE_SPEECH_REVIEWS)[number];

export const WITHHELD_REASONS: Readonly<Record<string, string>> = {
  too_short: "passage trop court",
  silent: "silence",
  language: "langue non arabe ou incertaine",
  low_confidence: "transcription peu sûre",
  too_few_words: "trop peu de mots",
  hallucination: "transcription incohérente",
  quran_like: "ressemble au Coran",
  known_formula: "formule connue",
  translation_implausible: "traduction douteuse",
  translation_unreliable: "traduction non confirmée",
  no_translation: "pas de traduction",
};

const span = z.tuple([z.number().min(0), z.number().min(0)]);
const base = { index: z.number().int().min(0), t: span };

const translated = z
  .object({
    ...base,
    status: z.literal("translated"),
    transcript_ar: z.string().trim().min(1),
    translation_fr: z.string().trim().min(1),
    confidence: z.number().min(0).max(1).nullable(),
    language: z.string().nullable(),
    review: z.enum(FREE_SPEECH_REVIEWS),
    /** `glossary` : formule fixe écrite à la main ; `model` (défaut) : traduction automatique. */
    translation_source: z.enum(["glossary", "model"]).optional(),
  })
  .strict();

const withheld = z
  .object({
    ...base,
    status: z.literal("withheld"),
    reason: z.string().refine((r) => r in WITHHELD_REASONS),
  })
  .strict();

export const freeSpeechSchema = z
  .object({
    schema: z.literal(FREE_SPEECH_SCHEMA),
    notice: z.string().optional(),
    source: z.object({ recognition_sha256: z.string() }).passthrough(),
    engine: z
      .object({ transcriber: z.string(), translator: z.string() })
      .passthrough(),
    items: z.array(z.discriminatedUnion("status", [translated, withheld])),
  })
  .passthrough()
  .refine(
    (doc) => new Set(doc.items.map((i) => i.index)).size === doc.items.length,
    "index en double",
  );

export type FreeSpeech = z.infer<typeof freeSpeechSchema>;
export type FreeSpeechItem = FreeSpeech["items"][number];
export type TranslatedItem = Extract<FreeSpeechItem, { status: "translated" }>;

/** Lit un fichier de parole libre ; tout écart le fait ignorer (null) plutôt que d'afficher un doute. */
export function parseFreeSpeech(raw: unknown): FreeSpeech | null {
  const parsed = freeSpeechSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Les passages par rang d'intervalle du résultat. */
export function freeSpeechByIndex(
  doc: FreeSpeech | null,
): Map<number, FreeSpeechItem> {
  return new Map((doc?.items ?? []).map((item) => [item.index, item]));
}

/**
 * Ce que la vidéo peut montrer : les passages traduits non rejetés. Un passage « en attente » n'y
 * entre que si l'export l'a choisi explicitement (`includePending`).
 */
export function shownFreeSpeech(
  items: ReadonlyMap<number, FreeSpeechItem> | null | undefined,
  includePending: boolean,
): Map<number, TranslatedItem> {
  const out = new Map<number, TranslatedItem>();
  for (const [index, item] of items ?? []) {
    if (item.status !== "translated" || item.review === "rejected") continue;
    if (item.review === "pending" && !includePending) continue;
    out.set(index, item);
  }
  return out;
}
