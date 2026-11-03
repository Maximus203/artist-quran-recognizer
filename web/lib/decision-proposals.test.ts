import { describe, expect, it } from "vitest";
import { proposalsFromDecisions } from "./decision-proposals";
import {
  parseDecisions,
  type Decision,
  type DecisionsDocument,
} from "./decisions";
import { intervalFingerprint } from "./decisions-fingerprint";

const UNC = {
  kind: "verse",
  ref: "11:61",
  words: [1, 10],
  status: "uncertain",
  t: [48.2, 62.6] as [number, number],
  candidates: ["11:61", "7:73"],
};
const NOW = "2026-10-23T16:00:00.000Z";
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

function decision(over: Partial<Decision> & { n?: number }): Decision {
  return {
    id: id(over.n ?? 1),
    kind: "choose",
    target: {
      fingerprint: intervalFingerprint(UNC),
      item: "uncertain",
      index: 0,
      snapshot: { ...UNC },
      review_ids: [],
    },
    value: { ref: "11:61", words: [1, 10] },
    evidence: { listened: true, listened_s: 14, device: "desktop" },
    use_for_training: true,
    decided_by: "Amina",
    decided_at: "2026-10-23T14:00:00Z",
    revision: 1,
    superseded_by: null,
    withdrawn_at: null,
    ...over,
  };
}
const docOf = (
  training: boolean,
  ...decisions: Decision[]
): DecisionsDocument =>
  parseDecisions({
    schema: "aqr.decisions/1",
    session_id: "5014015f-0000-4000-8000-000000000001",
    prediction_sha256: null,
    consent: { training, by: "Amina", at: NOW },
    revision: 1,
    updated_at: NOW,
    decisions,
  });
const propose = (doc: DecisionsDocument | null, taken = new Set<string>()) =>
  proposalsFromDecisions(doc, [UNC], taken, NOW);

describe("propositions de vérité terrain issues de l'export", () => {
  it("une correction écoutée et consentie devient une proposition, jamais validée seule", () => {
    const [passage] = propose(docOf(true, decision({})));
    expect(passage).toMatchObject({
      id: id(1),
      verses: "11:61[1-10]",
      t: [48.2, 62.6],
      status: "proposed",
      alignment: null,
      source: "export-review",
      reviewer: "Amina",
    });
  });
  it("est idempotente : une décision déjà proposée n'est pas redoublée", () => {
    expect(propose(docOf(true, decision({})), new Set([id(1)]))).toEqual([]);
  });
  it("sans consentement du document, rien", () => {
    expect(propose(docOf(false, decision({})))).toEqual([]);
    expect(propose(null)).toEqual([]);
  });
  it("sans consentement de la décision, ou sans écoute, rien", () => {
    expect(propose(docOf(true, decision({ use_for_training: false })))).toEqual(
      [],
    );
    expect(
      propose(
        docOf(
          true,
          decision({
            evidence: { listened: false, listened_s: 0, device: "x" },
          }),
        ),
      ),
    ).toEqual([]);
  });
  it("ignorer, exclure, la portée de la traduction et une décision annulée ne sont jamais de la vérité terrain", () => {
    const base = decision({}).target;
    expect(
      propose(docOf(true, decision({ kind: "ignore", value: {} }))),
    ).toEqual([]);
    expect(
      propose(
        docOf(
          true,
          decision({ kind: "exclude", value: { reason: "not_quran" } }),
        ),
      ),
    ).toEqual([]);
    expect(
      propose(
        docOf(
          true,
          decision({
            kind: "translation_scope",
            value: { scope: "verse" },
            target: { ...base, item: "approx" },
          }),
        ),
      ),
    ).toEqual([]);
    expect(
      propose(docOf(true, decision({ withdrawn_at: "2026-10-23T15:00:00Z" }))),
    ).toEqual([]);
  });
  it("une décision orpheline (le passage a changé) n'est pas proposée", () => {
    const moved = { ...UNC, t: [49, 62.6] as [number, number] };
    expect(
      proposalsFromDecisions(
        docOf(true, decision({})),
        [moved],
        new Set(),
        NOW,
      ),
    ).toEqual([]);
  });
});
