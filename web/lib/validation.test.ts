import { describe, expect, it } from "vitest";
import {
  addPassage,
  applyAlignment,
  applyProposals,
  editPassage,
  emptyValidation,
  validatedDocument,
} from "./validation";

const SESSION = "6f353ee1-3ee5-42e7-9c01-68135952a6a2";
const SHA = "a".repeat(64);
const plan = {
  schema: "aqr.align-plan/1",
  source: { sha256: SHA, duration_s: 200 },
  passages: [
    { t: [46.1, 84.8], verses: "21:51-21:54" },
    { t: [90, 106], verses: "21:56" },
  ],
};
const span = (ref: string, t: [number, number]) => ({
  ref,
  kind: "verse",
  words: [1, 9],
  partial: false,
  t,
  word_times: [[1, t[0], t[1]]],
});
function alignment(passages: unknown[], sha = SHA) {
  return {
    schema: "aqr.alignment/2",
    kind: "forced_alignment",
    source: { file: "source.mp3", sha256: sha, duration_s: 200 },
    engine: { model: "fastconformer-quran@b33af7936f9a/ctc", corpus: "tanzil" },
    config: { energy_ratio: 0.1 },
    passages,
  };
}
const ok = (declared: string, t: [number, number]) => ({
  declared,
  t,
  variant: "simple",
  evidence: {
    llr_per_frame: -0.26,
    forced_logprob: -4,
    free_logprob: -1,
    frames: 40,
  },
  spans: [span("21:51", [t[0] + 1, t[1] - 1])],
});

function proposed() {
  return applyProposals(emptyValidation(SESSION, SHA), plan);
}

describe("propositions", () => {
  it("crée des passages à corriger, jamais validés d'office", () => {
    const v = proposed();
    expect(v.passages.map((p) => [p.verses, p.status])).toEqual([
      ["21:51-21:54", "proposed"],
      ["21:56", "proposed"],
    ]);
  });
  it("refuse un plan d'un autre audio", () => {
    const other = { ...plan, source: { sha256: "b".repeat(64) } };
    expect(() => applyProposals(emptyValidation(SESSION, SHA), other)).toThrow(
      "autre audio",
    );
  });
  it("ne remplace jamais un travail humain", () => {
    const v = proposed();
    const [first] = v.passages;
    const aligned = applyAlignment(
      v,
      [first.id],
      alignment([ok("21:51-21:54", first.t)]),
    );
    expect(() => applyProposals(aligned, plan)).toThrow("déjà alignés");
  });
});

describe("alignement puis validation", () => {
  it("un passage aligné sans erreur devient validable", () => {
    const v = proposed();
    const [first, second] = v.passages;
    const aligned = applyAlignment(
      v,
      [first.id, second.id],
      alignment([
        ok("21:51-21:54", first.t),
        { declared: "21:56", t: second.t, error: "ne tient pas" },
      ]),
    );
    expect(aligned.passages.map((p) => p.status)).toEqual([
      "aligned",
      "proposed",
    ]);
    expect(aligned.passages[1].alignment?.error).toBe("ne tient pas");
    const validated = editPassage(aligned, first.id, { status: "validated" });
    expect(validated.passages[0].status).toBe("validated");
    expect(() =>
      editPassage(aligned, second.id, { status: "validated" }),
    ).toThrow("aligné");
  });
  it("modifier la déclaration oblige à réaligner", () => {
    const v = proposed();
    const [first] = v.passages;
    const aligned = applyAlignment(
      v,
      [first.id],
      alignment([ok("21:51-21:54", first.t)]),
    );
    const edited = editPassage(aligned, first.id, {
      verses: "21:51-21:53, 21:53[2-5]",
    });
    expect(edited.passages[0].status).toBe("proposed");
    expect(edited.passages[0].alignment).toBeNull();
  });
  it("refuse un alignement d'un autre audio ou incomplet", () => {
    const v = proposed();
    const [first, second] = v.passages;
    expect(() =>
      applyAlignment(
        v,
        [first.id],
        alignment([ok("x", first.t)], "c".repeat(64)),
      ),
    ).toThrow("autre audio");
    expect(() =>
      applyAlignment(v, [first.id, second.id], alignment([ok("x", first.t)])),
    ).toThrow("incomplet");
  });
});

describe("document pour le manifeste", () => {
  it("ne contient que les passages validés, avec moteur et réglages", () => {
    let v = proposed();
    const [first, second] = v.passages;
    v = applyAlignment(
      v,
      [first.id, second.id],
      alignment([ok("a", first.t), ok("b", second.t)]),
    );
    expect(() => validatedDocument(v)).toThrow("Aucun passage validé");
    v = editPassage(v, second.id, { status: "validated" });
    v = editPassage(v, first.id, { status: "excluded" });
    const doc = validatedDocument(v) as {
      passages: { declared: string }[];
      engine: unknown;
    };
    expect(doc.passages.map((p) => p.declared)).toEqual(["b"]);
    expect(doc.engine).toEqual({
      model: "fastconformer-quran@b33af7936f9a/ctc",
      corpus: "tanzil",
    });
    expect(JSON.stringify(doc)).not.toContain(
      '"config":{"energy_ratio":0.1},"t"',
    );
  });
  it("ajoute un passage manuel trié dans le temps", () => {
    const v = addPassage(proposed(), [10, 20], "1:1-1:7");
    expect(v.passages[0].verses).toBe("1:1-1:7");
    expect(() => addPassage(proposed(), [20, 10], "1:1")).toThrow();
  });
});

describe("formules", () => {
  it("un âmîn aligné est gardé comme zone non coranique", () => {
    const v = proposed();
    const [first] = v.passages;
    const passage = {
      ...ok("1:7, amin", first.t),
      spans: [
        span("1:7", [31, 41]),
        {
          kind: "non_quran",
          label: "amin",
          t: [42, 44.5],
          word_times: [[1, 42, 44.5]],
        },
      ],
    };
    const aligned = applyAlignment(v, [first.id], alignment([passage]));
    expect(aligned.passages[0].alignment?.spans?.map((s) => s.kind)).toEqual([
      "verse",
      "non_quran",
    ]);
  });
});
