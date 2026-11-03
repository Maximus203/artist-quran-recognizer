import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  DECISIONS_SCHEMA,
  DecisionsError,
  ITEMS,
  KINDS,
  activeDecisions,
  parseDecisions,
  parseValue,
  reconcile,
  suggestTarget,
  targetKey,
  type Decision,
  type DecisionsDocument,
} from "./decisions";
import {
  intervalFingerprint,
  type EngineInterval,
} from "./decisions-fingerprint";
import { clearExportCache } from "./export-engine";
import { withLock } from "./lock";
import {
  atomicJson,
  readResult,
  readReview,
  readSession,
  sessionDir,
} from "./store";

/**
 * Le calque de décisions d'une session (`decisions.json`, `aqr.decisions/1`, ADR-0014) : lecture,
 * enregistrement atomique sous verrou, annulation, consentement d'entraînement, réconciliation après
 * une nouvelle analyse. Ne modifie JAMAIS `prediction.recognition.json`. Le serveur — jamais le client —
 * fixe l'empreinte, l'auteur, la date, la révision et la copie du consentement.
 */
export type Actor = { username: string; isOwner: boolean; isAdmin: boolean };

export class DecisionsForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionsForbiddenError";
  }
}

const file = (id: string) => path.join(sessionDir(id), "decisions.json");

export async function readDecisions(
  id: string,
): Promise<DecisionsDocument | null> {
  try {
    return parseDecisions(JSON.parse(await readFile(file(id), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

const uuid = z.string().uuid();
const evidence = z
  .object({
    listened: z.boolean(),
    listened_s: z.number().min(0).max(86_400),
    device: z.string().max(32),
  })
  .partial()
  .strict();
export const opsSchema = z.object({
  ops: z
    .array(
      z.discriminatedUnion("op", [
        z.object({
          op: z.literal("decide"),
          item: z.enum(ITEMS),
          index: z.number().int().min(0).nullable().optional(),
          review_ids: z.array(uuid).max(50).optional(),
          kind: z.enum(KINDS),
          value: z.record(z.string(), z.unknown()),
          evidence: evidence.optional(),
        }),
        z.object({ op: z.literal("withdraw"), id: uuid }),
        z.object({ op: z.literal("consent"), training: z.boolean() }),
        z.object({ op: z.literal("training"), id: uuid, use: z.boolean() }),
        z.object({
          op: z.literal("reattach"),
          id: uuid,
          index: z.number().int().min(0),
        }),
      ]),
    )
    .min(1)
    .max(50),
});
export type Ops = z.infer<typeof opsSchema>["ops"];

type Interval = EngineInterval & { t?: [number, number] | null };

function snapshotOf(interval: Interval): Record<string, unknown> {
  return {
    kind: interval.kind,
    status: interval.status ?? null,
    ref: interval.ref ?? null,
    words: interval.words ?? null,
    t: interval.t ?? null,
    candidates: interval.candidates ?? [],
  };
}

function blank(
  id: string,
  sha: string | null,
  actor: Actor,
  now: string,
): DecisionsDocument {
  return {
    schema: DECISIONS_SCHEMA,
    session_id: id,
    prediction_sha256: sha,
    // Consentement : activé pour ses propres sessions, verrouillé à faux pour celles des autres.
    consent: { training: actor.isOwner, by: actor.username, at: now },
    revision: 0,
    updated_at: now,
    decisions: [],
  };
}

async function reviewIds(id: string): Promise<Set<string>> {
  const review = await readReview(id);
  return new Set(
    (review?.annotations ?? [])
      .filter((a) => a.status === "confirmed")
      .map((a) => a.id),
  );
}

function apply(
  doc: DecisionsDocument,
  op: Ops[number],
  ctx: {
    intervals: Interval[];
    known: Set<string>;
    actor: Actor;
    now: string;
  },
): void {
  const { intervals, known, actor, now } = ctx;
  if (op.op === "consent") {
    if (!actor.isOwner)
      throw new DecisionsForbiddenError(
        "Seul le propriétaire de l'audio consent à l'usage de ses corrections pour l'entraînement.",
      );
    doc.consent = { training: op.training, by: actor.username, at: now };
    return;
  }
  if (op.op === "training") {
    if (!actor.isOwner)
      throw new DecisionsForbiddenError(
        "Seul le propriétaire règle l'usage d'une correction.",
      );
    const found = doc.decisions.find((d) => d.id === op.id);
    if (!found) throw new DecisionsError("Décision inconnue.");
    found.use_for_training = op.use;
    return;
  }
  if (op.op === "withdraw") {
    const found = doc.decisions.find((d) => d.id === op.id);
    if (!found) throw new DecisionsError("Décision inconnue.");
    if (found.withdrawn_at === null) found.withdrawn_at = now;
    return;
  }
  const make = (
    partial: Omit<
      Decision,
      | "id"
      | "revision"
      | "decided_at"
      | "decided_by"
      | "superseded_by"
      | "withdrawn_at"
      | "use_for_training"
    >,
  ): Decision => {
    const next: Decision = {
      ...partial,
      id: randomUUID(),
      use_for_training: doc.consent.training && actor.isOwner,
      decided_by: actor.username,
      decided_at: now,
      revision: 1,
      superseded_by: null,
      withdrawn_at: null,
    };
    const key = targetKey(next);
    for (const old of doc.decisions) {
      if (
        old.superseded_by === null &&
        old.withdrawn_at === null &&
        targetKey(old) === key
      ) {
        old.superseded_by = next.id;
        next.revision = Math.max(next.revision, old.revision + 1);
      }
    }
    doc.decisions.push(next);
    return next;
  };
  if (op.op === "reattach") {
    const old = doc.decisions.find((d) => d.id === op.id);
    const interval = intervals[op.index];
    if (!old || old.withdrawn_at !== null || old.superseded_by !== null)
      throw new DecisionsError("Décision inconnue ou déjà annulée.");
    if (!interval || interval.kind !== "verse")
      throw new DecisionsError("Ce passage n'existe pas.");
    const moved = make({
      kind: old.kind,
      target: {
        fingerprint: intervalFingerprint(interval),
        item: old.target.item,
        index: op.index,
        snapshot: snapshotOf(interval),
        review_ids: old.target.review_ids,
      },
      value: old.value,
      evidence: old.evidence,
    });
    old.superseded_by = moved.id;
    moved.revision = old.revision + 1;
    return;
  }
  // decide
  const value = parseValue(op.kind, op.value, "value");
  const ids = op.review_ids ?? [];
  const unknown = ids.filter((i) => !known.has(i));
  if (unknown.length) throw new DecisionsError("Signalement inconnu.");
  const base = {
    kind: op.kind,
    value,
    evidence: {
      listened: op.evidence?.listened ?? false,
      listened_s: op.evidence?.listened_s ?? 0,
      device: op.evidence?.device ?? "unknown",
    },
  };
  if (op.index !== undefined && op.index !== null) {
    const interval = intervals[op.index];
    if (!interval || interval.kind !== "verse")
      throw new DecisionsError("Ce passage n'existe pas.");
    if (op.item === "uncertain" && interval.status !== "uncertain")
      throw new DecisionsError("Ce passage n'est pas un passage incertain.");
    if (op.item === "inferred" && interval.status !== "inferred")
      throw new DecisionsError("Ce passage n'est pas un verset supposé.");
    make({
      ...base,
      target: {
        fingerprint: intervalFingerprint(interval),
        item: op.item,
        index: op.index,
        snapshot: snapshotOf(interval),
        review_ids: ids,
      },
    });
    return;
  }
  if (!ids.length)
    throw new DecisionsError(
      "Une décision vise un passage du moteur ou un signalement.",
    );
  make({
    ...base,
    target: {
      fingerprint: null,
      item: op.item,
      index: null,
      snapshot: { kind: "report", t: value.t ?? null },
      review_ids: ids,
    },
  });
}

export type DecisionsView = {
  consent: DecisionsDocument["consent"];
  revision: number;
  prediction_sha256: string | null;
  /** Les décisions ont été prises sur une autre analyse que l'actuelle. */
  stale: boolean;
  is_owner: boolean;
  decisions: (Decision & {
    state: "applied" | "report" | "orphan" | "withdrawn" | "superseded";
  })[];
  orphans: {
    decision: Decision;
    suggestion: {
      index: number;
      ref: string | null;
      t: [number, number];
    } | null;
  }[];
};

export async function decisionsView(
  id: string,
  actor: Actor,
): Promise<DecisionsView> {
  const [session, doc, result] = await Promise.all([
    readSession(id),
    readDecisions(id),
    readResult(id),
  ]);
  const document =
    doc ??
    blank(id, session.prediction_sha256, actor, new Date().toISOString());
  const intervals = (result?.parsed.intervals ?? []) as Interval[];
  const active = activeDecisions(document);
  const rec = reconcile(
    intervals,
    active,
    intervalFingerprint as (i: never) => string,
  );
  const known = await reviewIds(id);
  const liveReports = rec.reports.filter((d) =>
    d.target.review_ids.some((i) => known.has(i)),
  );
  const deadReports = rec.reports.filter((d) => !liveReports.includes(d));
  const orphanIds = new Set([...rec.orphans, ...deadReports].map((d) => d.id));
  const reportIds = new Set(liveReports.map((d) => d.id));
  const taken = new Set(rec.applied.keys());
  return {
    consent: document.consent,
    revision: document.revision,
    prediction_sha256: session.prediction_sha256,
    stale:
      document.decisions.length > 0 &&
      document.prediction_sha256 !== null &&
      document.prediction_sha256 !== session.prediction_sha256,
    is_owner: actor.isOwner,
    decisions: document.decisions.map((d) => ({
      ...d,
      state:
        d.withdrawn_at !== null
          ? "withdrawn"
          : d.superseded_by !== null
            ? "superseded"
            : orphanIds.has(d.id)
              ? "orphan"
              : reportIds.has(d.id)
                ? "report"
                : "applied",
    })),
    orphans: [
      ...rec.orphans.map((decision) => ({
        decision,
        suggestion: suggestTarget(decision, intervals, taken),
      })),
      ...deadReports.map((decision) => ({ decision, suggestion: null })),
    ],
  };
}

/**
 * Applique des opérations (décider, annuler, consentir, rattacher) et enregistre le document ENTIER
 * d'un coup, sous verrou : deux enregistrements simultanés ne s'écrasent pas. Le document est relu
 * par le même lecteur strict que celui du moteur avant d'être écrit : ce qui part sur le disque est
 * toujours lisible par l'export.
 */
export function updateDecisions(
  id: string,
  rawOps: unknown,
  actor: Actor,
): Promise<DecisionsView> {
  return withLock(`decisions:${id}`, async () => {
    const { ops } = opsSchema.parse(rawOps);
    const session = await readSession(id);
    const result = await readResult(id);
    if (!result)
      throw new DecisionsError("Il n'y a pas encore de résultat à corriger.");
    const now = new Date().toISOString();
    const current =
      (await readDecisions(id)) ??
      blank(id, session.prediction_sha256, actor, now);
    const doc: DecisionsDocument = structuredClone(current);
    const ctx = {
      intervals: result.parsed.intervals as Interval[],
      known: await reviewIds(id),
      actor,
      now,
    };
    for (const op of ops) apply(doc, op, ctx);
    doc.revision += 1;
    doc.updated_at = now;
    doc.prediction_sha256 = session.prediction_sha256;
    await atomicJson(file(id), parseDecisions(doc));
    clearExportCache();
    return decisionsView(id, actor);
  });
}
