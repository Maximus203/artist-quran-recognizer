import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DecisionsError,
  activeDecisions,
  parseDecisions,
  reconcile,
  suggestTarget,
  targetKey,
  type Decision,
  type DecisionsDocument,
} from "./decisions";
import {
  canonicalInterval,
  intervalFingerprint,
} from "./decisions-fingerprint";

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../tests/fixtures/decisions/${name}`, import.meta.url),
      "utf8",
    ),
  );

describe("empreinte d'un intervalle", () => {
  const vectors = fixture("fingerprint-vectors.json") as {
    name: string;
    interval: never;
    fingerprint: string;
  }[];
  it.each(vectors.map((v) => [v.name, v] as const))(
    "même empreinte que Python : %s",
    (_name, vector) => {
      expect(intervalFingerprint(vector.interval)).toBe(vector.fingerprint);
    },
  );
  it("arrondit au demi vers le haut, en millisecondes entières", () => {
    expect(canonicalInterval({ kind: "verse", t: [1.0005, 2.0015] }).t).toEqual(
      [1001, 2002],
    );
    expect(canonicalInterval({ kind: "verse", t: [0.285, 1.005] }).t).toEqual([
      285, 1005,
    ]);
  });
  it("ne concerne que les versets", () => {
    expect(() => intervalFingerprint({ kind: "abstention" })).toThrow(
      DecisionsError,
    );
  });
});

describe("lecture stricte, même verdict que Python", () => {
  const cases = fixture("documents.json") as {
    name: string;
    valid: boolean;
    document: unknown;
  }[];
  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    if (c.valid) expect(() => parseDecisions(c.document)).not.toThrow();
    else expect(() => parseDecisions(c.document)).toThrow(DecisionsError);
  });
});

const doc = (): DecisionsDocument =>
  parseDecisions(fixture("documents.json")[1].document);
const withDecisions = (...d: Decision[]): DecisionsDocument => ({
  ...doc(),
  decisions: d,
});

describe("décisions actives", () => {
  const base = doc().decisions[0];
  const copy = (over: Partial<Decision>): Decision => ({ ...base, ...over });
  const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
  it("ignore l'annulée et la remplacée", () => {
    const active = activeDecisions(
      withDecisions(
        copy({ id: id(1), withdrawn_at: "2026-10-23T15:00:00Z" }),
        copy({ id: id(2), superseded_by: id(3) }),
        copy({ id: id(3) }),
      ),
    );
    expect(active.map((d) => d.id)).toEqual([id(3)]);
  });
  it("garde la plus récente quand deux sont actives sur la même cible", () => {
    const active = activeDecisions(
      withDecisions(
        copy({ id: id(1), decided_at: "2026-10-23T14:00:00Z" }),
        copy({ id: id(2), decided_at: "2026-10-23T14:05:00Z" }),
      ),
    );
    expect(active.map((d) => d.id)).toEqual([id(2)]);
  });
  it("une coupure et une traduction approximative ont chacune leur décision", () => {
    const a = copy({
      id: id(1),
      kind: "confirm_partial",
      value: {},
      target: { ...base.target, item: "cut" },
    });
    const b = copy({
      id: id(2),
      kind: "translation_scope",
      value: { scope: "verse" },
      target: { ...base.target, item: "approx" },
    });
    expect(targetKey(a)).not.toBe(targetKey(b));
    expect(activeDecisions(withDecisions(a, b))).toHaveLength(2);
  });
});

describe("réconciliation", () => {
  const unc = {
    kind: "verse",
    ref: "11:61",
    words: [1, 10],
    status: "uncertain",
    t: [48.2, 62.6],
    candidates: ["11:61", "7:73"],
  };
  const fp = (i: never) => intervalFingerprint(i);
  const base = doc().decisions[0];
  const decision = (fingerprint: string | null, over = {}): Decision => ({
    ...base,
    target: { ...base.target, fingerprint, index: 7 },
    ...over,
  });

  it("retrouve l'intervalle par l'empreinte, jamais par la position", () => {
    const result = reconcile(
      [{ kind: "abstention" }, unc],
      [decision(intervalFingerprint(unc))],
      fp,
    );
    expect([...result.applied.keys()]).toEqual([1]);
    expect(result.orphans).toEqual([]);
  });
  it("une décision dont l'intervalle a changé devient orpheline", () => {
    const moved = { ...unc, t: [48.5, 62.6] };
    const result = reconcile([moved], [decision(intervalFingerprint(unc))], fp);
    expect(result.applied.size).toBe(0);
    expect(result.orphans).toHaveLength(1);
  });
  it("une décision annulée n'est ni appliquée ni orpheline", () => {
    const result = reconcile(
      [unc],
      [
        decision(intervalFingerprint(unc), {
          withdrawn_at: "2026-10-23T15:00:00Z",
        }),
      ],
      fp,
    );
    expect(result.applied.size + result.orphans.length).toBe(0);
  });
  it("suggère le passage le plus proche dans le temps sans l'appliquer", () => {
    const moved = { ...unc, t: [48.5, 62.6] as [number, number] };
    const orphan = decision(intervalFingerprint(unc), {
      target: {
        ...base.target,
        fingerprint: intervalFingerprint(unc),
        snapshot: { t: [48.2, 62.6] },
      },
    });
    expect(suggestTarget(orphan, [moved], new Set())?.index).toBe(0);
    expect(suggestTarget(orphan, [moved], new Set([0]))).toBeNull();
    expect(
      suggestTarget(orphan, [{ ...moved, t: [100, 110] }], new Set()),
    ).toBeNull();
  });
});
