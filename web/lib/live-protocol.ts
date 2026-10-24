/**
 * Messages `aqr.live/1` reçus du service (docs/LIVE-PROTOCOL.md) : types et validation à la
 * réception. INVARIANT I1/I3 : on ne fabrique ni texte coranique ni nom de verset ; ce module ne fait
 * que dire si un message a la forme annoncée. Les champs inconnus sont tolérés (le contrat est
 * additif) ; un message mal formé est écarté, jamais « réparé ».
 */
import { z } from "zod";

export const LIVE_SCHEMA = "aqr.live/1";

const num = z.number().finite();
const pair = z.tuple([num, num]);

const translation = z.looseObject({
  text: z.string(),
  translation_id: z.string(),
  version: z.string(),
  attribution: z.string(),
  scope: z.string().optional(),
});
export type LiveTranslation = z.infer<typeof translation>;

const interval = z.looseObject({
  kind: z.literal("verse"),
  ref: z.string(),
  words: pair.nullish(),
  partial: z.boolean().optional(),
  status: z.enum(["recognized", "inferred", "uncertain"]),
  t: z.tuple([num, num.nullable()]),
  repetition: z.boolean().optional(),
  text: z.string().nullish(),
  translation: translation.nullish(),
  translation_unavailable: z.boolean().optional(),
  identity_basis: z.enum(["words", "context"]).optional(),
  words_heard: z.number().int().nonnegative().optional(),
  candidates: z.array(z.string()).optional(),
  candidate_count: z.number().int().nonnegative().optional(),
});
export type LiveInterval = z.infer<typeof interval>;

const envelope = {
  schema: z.literal(LIVE_SCHEMA),
  seq: z.number().int().nonnegative(),
  t: num,
};
const kind = <T extends string>(type: T) => ({
  type: z.literal(type),
  ...envelope,
});

const heard = z.looseObject({
  words: pair.optional(),
  text: z.string().optional(),
  translation: translation.optional(),
});

const READY = z.looseObject({
  ...kind("READY"),
  session_id: z.string(),
  resumed: z.boolean(),
  last_seq: z.number().int().nonnegative(),
  audio_received_samples: z.number().int().nonnegative(),
  degraded: z.array(z.union([z.string(), z.number()])),
  technical: z.boolean(),
  resume_ttl_s: z.number().positive(),
});
const PARTIAL = z.looseObject({
  ...kind("PARTIAL"),
  text: z.string(),
  stable: z.boolean(),
});
const CANDIDATES = z.looseObject({
  ...kind("CANDIDATES"),
  count: z.number().int().nonnegative(),
  words_heard: z.number().int().nonnegative(),
  heard: heard.nullable(),
  items: z.array(z.looseObject({ ref: z.string() })),
  leader: z
    .looseObject({ ref: z.string(), basis: z.enum(["words", "context"]) })
    .nullish(),
});
const LOCKED = z.looseObject({ ...kind("LOCKED"), interval });
const PROGRESS = z.looseObject({
  ...kind("PROGRESS"),
  ref: z.string(),
  words_heard: z.number().int().nonnegative(),
});
const CONTINUE = z.looseObject({
  ...kind("CONTINUE"),
  closed: interval,
  complete: z.boolean().optional(),
  expected: z.looseObject({ ref: z.string() }).nullable(),
});
const REVISION = z.looseObject({
  ...kind("REVISION"),
  ref: z.string(),
  status: z.string(),
  reason: z.string().optional(),
});
const JUMP = z.looseObject({
  ...kind("JUMP"),
  from: z.string().optional(),
  kind: z.enum(["repeat", "back", "skip", "other_surah"]).catch("skip"),
});
const LOST = z.looseObject({
  ...kind("LOST"),
  reason: z
    .enum(["silence", "non_quran", "no_candidate"])
    .catch("no_candidate"),
});
const BASMALA = z.looseObject({
  ...kind("BASMALA"),
  ref: z.string().optional(),
  text: z.string().nullish(),
  translation: translation.nullish(),
});
const DEGRADED = z.looseObject({
  ...kind("DEGRADED"),
  tier: z.number().int(),
  overloaded: z.boolean(),
  lag_s: num,
  skipped: z.array(z.string()),
  reason: z.string().optional(),
});
const FINALIZING = z.looseObject({
  ...kind("FINALIZING"),
  pending_s: num.nullish(),
});
const FINAL = z.looseObject({ ...kind("FINAL"), document: z.unknown() });
const ERROR = z.looseObject({
  ...kind("ERROR"),
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().optional(),
  retry_after_s: z.number().nonnegative().optional(),
});

const SCHEMAS = {
  READY,
  PARTIAL,
  CANDIDATES,
  LOCKED,
  PROGRESS,
  CONTINUE,
  REVISION,
  JUMP,
  LOST,
  BASMALA,
  DEGRADED,
  FINALIZING,
  FINAL,
  ERROR,
} as const;

export type ServerMessage = {
  [K in keyof typeof SCHEMAS]: z.infer<(typeof SCHEMAS)[K]>;
}[keyof typeof SCHEMAS];
export type MessageOf<T extends ServerMessage["type"]> = Extract<
  ServerMessage,
  { type: T }
>;

export type Parsed =
  | { ok: true; message: ServerMessage }
  | { ok: false; reason: "not_json" | "unknown_type" | "malformed" };

/** Lit un message texte du service. Un type inconnu ou mal formé est écarté (jamais deviné). */
export function parseServerMessage(raw: unknown): Parsed {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, reason: "not_json" };
    }
  }
  if (data === null || typeof data !== "object")
    return { ok: false, reason: "not_json" };
  const type = String((data as { type?: unknown }).type);
  if (!Object.hasOwn(SCHEMAS, type))
    return { ok: false, reason: "unknown_type" };
  const result = SCHEMAS[type as keyof typeof SCHEMAS].safeParse(data);
  return result.success
    ? { ok: true, message: result.data as ServerMessage }
    : { ok: false, reason: "malformed" };
}

/** Codes d'erreur du service qui ne demandent pas de nouvel essai du même flux (docs/LIVE-PROTOCOL.md §4). */
export const FATAL_CODES = new Set([
  "bad_message",
  "unsupported_schema",
  "bad_audio_format",
]);
