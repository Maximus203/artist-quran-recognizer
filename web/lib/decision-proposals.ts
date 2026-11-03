import {
  activeDecisions,
  reconcile,
  type Decision,
  type DecisionsDocument,
} from "./decisions";
import { intervalFingerprint } from "./decisions-fingerprint";
import type { Passage } from "./validation";

/**
 * Des corrections écoutées de l'export aux passages proposés à la vérité terrain (ADR-0014).
 * Fonction pure. Une décision devient une PROPOSITION seulement si : (1) elle est de nature
 * factuelle (`choose`, `set_ref`, `confirm_inferred`, `confirm_partial` — jamais `ignore`,
 * `dismiss_report`, `translation_scope` ni une exclusion, qui ne disent pas quel verset est récité),
 * (2) le passage a été écouté, (3) le consentement du document ET celui de la décision sont donnés,
 * (4) elle s'applique encore à un passage de l'analyse courante (pas une orpheline).
 * L'identifiant du passage proposé est celui de la décision : l'appel est idempotent.
 */
const PROPOSING: readonly Decision["kind"][] = [
  "choose",
  "set_ref",
  "confirm_inferred",
  "confirm_partial",
];

type Interval = { kind: string; t?: [number, number] | null };

export function proposalsFromDecisions(
  doc: DecisionsDocument | null,
  intervals: readonly Interval[],
  alreadyProposed: ReadonlySet<string>,
  now = new Date().toISOString(),
): Passage[] {
  if (!doc || !doc.consent.training) return [];
  const active = activeDecisions(doc);
  const { applied, reports } = reconcile(
    intervals,
    active,
    intervalFingerprint as (i: never) => string,
  );
  const live = new Set(
    [...applied.values()]
      .flat()
      .concat(reports)
      .map((d) => d.id),
  );
  const out: Passage[] = [];
  for (const d of active) {
    if (!live.has(d.id) || alreadyProposed.has(d.id)) continue;
    if (
      !PROPOSING.includes(d.kind) ||
      !d.evidence.listened ||
      !d.use_for_training
    )
      continue;
    const snap = d.target.snapshot;
    const ref = d.value.ref ?? (typeof snap.ref === "string" ? snap.ref : null);
    const words =
      d.value.words ??
      (Array.isArray(snap.words) ? (snap.words as [number, number]) : null);
    const t =
      d.value.t ??
      (Array.isArray(snap.t) ? (snap.t as [number, number]) : null);
    if (!ref || !words || !t || !(t[1] > t[0])) continue;
    out.push({
      id: d.id,
      t,
      verses: `${ref}[${words[0]}-${words[1]}]`,
      status: "proposed",
      alignment: null,
      updated_at: now,
      source: "export-review",
      reviewer: d.decided_by,
    });
  }
  return out;
}
