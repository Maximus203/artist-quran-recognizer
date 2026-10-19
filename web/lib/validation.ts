import { z } from "zod";

/**
 * Vérité terrain semi-automatique (étape A, ADR-0006) : le moteur propose des passages, l'humain
 * corrige la déclaration (ce qui est récité), `aqr align` pose les temps, l'humain écoute puis
 * valide ou exclut. Seuls les passages validés partent dans le manifeste.
 */
/**
 * Repère d'affichage de la preuve acoustique (`llr_per_frame`), pas un seuil de décision :
 * mesuré le 2026-10-19 (docs/evaluation/alignment-2026-10-19.md), une bonne déclaration donne
 * -0,2 à -0,7 par trame, une déclaration décalée d'un verset -1,5. À recalibrer sur des
 * passages validés.
 */
export const EVIDENCE_HINT = -0.8;

const time = z.number().finite().nonnegative();
const wordTimes = z.array(z.tuple([z.number().int().positive(), time, time]));
const span = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("verse"),
    ref: z.string().regex(/^\d{1,3}:\d{1,3}$/),
    words: z.tuple([z.number().int().positive(), z.number().int().positive()]),
    partial: z.boolean(),
    t: z.tuple([time, time]),
    word_times: wordTimes,
  }),
  // Formule déclarée (amin, takbir, istiadha, basmala) : zone non coranique, jamais un verset.
  z.object({
    kind: z.literal("non_quran"),
    label: z.enum(["amin", "takbir", "istiadha", "basmala"]),
    t: z.tuple([time, time]),
    word_times: wordTimes,
  }),
]);
export type AlignedSpan = z.infer<typeof span>;
export const FORMULA_LABELS: Record<string, string> = {
  amin: "âmîn",
  takbir: "takbir",
  istiadha: "isti’adha",
  basmala: "basmala",
};
export const alignedPassageSchema = z.object({
  declared: z.string(),
  t: z.tuple([time, time]),
  error: z.string().optional(),
  variant: z.string().optional(),
  evidence: z
    .object({
      llr_per_frame: z.number(),
      forced_logprob: z.number(),
      free_logprob: z.number(),
      frames: z.number().int(),
    })
    .optional(),
  spans: z.array(span).optional(),
  engine: z.object({ model: z.string(), corpus: z.string() }),
  config: z.record(z.string(), z.unknown()),
});
export const passageSchema = z.object({
  id: z.string().uuid(),
  t: z.tuple([time, time]).refine(([a, b]) => b > a, "Passage vide"),
  verses: z.string().max(2000),
  status: z.enum(["proposed", "aligned", "validated", "excluded"]),
  alignment: alignedPassageSchema.nullable(),
  updated_at: z.string().datetime(),
});
export const validationSchema = z.object({
  schema: z.literal("aqr.validation/1"),
  session_id: z.string().uuid(),
  audio_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  passages: z.array(passageSchema),
  written: z
    .array(z.object({ at: z.string().datetime(), report: z.string() }))
    .default([]),
  updated_at: z.string().datetime(),
});
export type Passage = z.infer<typeof passageSchema>;
export type AlignedPassage = z.infer<typeof alignedPassageSchema>;
export type Validation = z.infer<typeof validationSchema>;

const planSchema = z.object({
  schema: z.literal("aqr.align-plan/1"),
  source: z.object({ sha256: z.string().nullable() }),
  passages: z.array(z.object({ t: z.tuple([time, time]), verses: z.string() })),
});
const alignmentSchema = z.object({
  schema: z.literal("aqr.alignment/2"),
  source: z.object({ sha256: z.string() }),
  engine: z.object({ model: z.string(), corpus: z.string() }),
  config: z.record(z.string(), z.unknown()),
  passages: z.array(
    alignedPassageSchema.omit({ engine: true, config: true }).passthrough(),
  ),
});

function now(): string {
  return new Date().toISOString();
}

export function emptyValidation(
  sessionId: string,
  audioSha256: string,
): Validation {
  return {
    schema: "aqr.validation/1",
    session_id: sessionId,
    audio_sha256: audioSha256,
    passages: [],
    written: [],
    updated_at: now(),
  };
}

/** Passages proposés par `aqr plan-alignment` ; refusé si un travail humain existe déjà. */
export function applyProposals(
  current: Validation,
  rawPlan: unknown,
): Validation {
  const plan = planSchema.parse(rawPlan);
  if (plan.source.sha256 && plan.source.sha256 !== current.audio_sha256)
    throw new Error("Propositions établies pour un autre audio.");
  if (current.passages.some((p) => p.status !== "proposed"))
    throw new Error(
      "Des passages sont déjà alignés ou validés : les propositions ne les remplacent pas.",
    );
  return {
    ...current,
    passages: plan.passages.map((p) => ({
      id: crypto.randomUUID(),
      t: p.t,
      verses: p.verses,
      status: "proposed",
      alignment: null,
      updated_at: now(),
    })),
    updated_at: now(),
  };
}

/** Modification humaine : déclaration, limites du passage, validation ou exclusion. */
export function editPassage(
  current: Validation,
  id: string,
  patch: Partial<Pick<Passage, "t" | "verses" | "status">>,
): Validation {
  const passages = current.passages.map((p) => {
    if (p.id !== id) return p;
    const changed =
      (patch.verses !== undefined && patch.verses !== p.verses) ||
      (patch.t !== undefined &&
        (patch.t[0] !== p.t[0] || patch.t[1] !== p.t[1]));
    const next: Passage = {
      ...p,
      ...patch,
      updated_at: now(),
    };
    if (changed) {
      // Une déclaration ou une fenêtre modifiée invalide l'alignement : il faut réaligner.
      next.alignment = null;
      next.status = "proposed";
    }
    if (next.status === "validated" && !isAligned(next))
      throw new Error("Seul un passage aligné sans erreur peut être validé.");
    return passageSchema.parse(next);
  });
  if (!passages.some((p) => p.id === id)) throw new Error("Passage inconnu");
  return { ...current, passages, updated_at: now() };
}

export function addPassage(
  current: Validation,
  t: [number, number],
  verses: string,
): Validation {
  const passage = passageSchema.parse({
    id: crypto.randomUUID(),
    t,
    verses,
    status: "proposed",
    alignment: null,
    updated_at: now(),
  });
  const passages = [...current.passages, passage].sort(
    (a, b) => a.t[0] - b.t[0],
  );
  return { ...current, passages, updated_at: now() };
}

export function isAligned(p: Passage): boolean {
  return Boolean(
    p.alignment && !p.alignment.error && p.alignment.spans?.length,
  );
}

/** Résultat de `aqr align --plan` pour les passages `ids`, dans le même ordre. */
export function applyAlignment(
  current: Validation,
  ids: string[],
  rawDocument: unknown,
): Validation {
  const document = alignmentSchema.parse(rawDocument);
  if (document.source.sha256 !== current.audio_sha256)
    throw new Error("Alignement établi pour un autre audio.");
  if (document.passages.length !== ids.length)
    throw new Error("Alignement incomplet : réessaie.");
  const byId = new Map(ids.map((id, i) => [id, document.passages[i]]));
  const passages = current.passages.map((p) => {
    const aligned = byId.get(p.id);
    if (!aligned) return p;
    const alignment = alignedPassageSchema.parse({
      ...aligned,
      engine: document.engine,
      config: document.config,
    });
    const ok = !alignment.error && Boolean(alignment.spans?.length);
    return {
      ...p,
      alignment,
      status: ok ? "aligned" : "proposed",
      updated_at: now(),
    } as Passage;
  });
  return { ...current, passages, updated_at: now() };
}

/** Document `aqr.alignment/2` des seuls passages validés, pour `aqr data import-alignment`. */
export function validatedDocument(
  current: Validation,
): Record<string, unknown> {
  const validated = current.passages.filter((p) => p.status === "validated");
  if (!validated.length) throw new Error("Aucun passage validé à écrire.");
  const first = validated[0].alignment!;
  const same = (a: AlignedPassage) =>
    a.engine.model === first.engine.model &&
    JSON.stringify(a.config) === JSON.stringify(first.config);
  if (!validated.every((p) => p.alignment && same(p.alignment)))
    throw new Error(
      "Passages validés avec des réglages d'alignement différents : réaligne-les.",
    );
  return {
    schema: "aqr.alignment/2",
    kind: "forced_alignment",
    source: { sha256: current.audio_sha256 },
    engine: first.engine,
    config: first.config,
    passages: validated.map((p) => {
      const { engine: _engine, config: _config, ...rest } = p.alignment!;
      return rest;
    }),
  };
}
