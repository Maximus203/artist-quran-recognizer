import { describe, expect, it } from "vitest";
import {
  buildDecision,
  choicesFor,
  pickOf,
  type DecisionDraft,
} from "./export-decision";
import { parseValue } from "./decisions";
import type { ReadinessItem } from "./export-types";

const base: ReadinessItem = {
  key: "k",
  type: "uncertain",
  index: 1,
  fingerprint: "f",
  t: [48.2, 62.6],
  ref: "11:61",
  words: [1, 10],
  impact: "arabic_sign",
  effective: true,
  state: "open",
  decision: null,
  review_ids: [],
  related_reports: [],
  candidates: [
    {
      ref: "11:61",
      words: [1, 10],
      words_total: 27,
      tokens: [],
      translation: null,
      translation_scope: null,
    },
    {
      ref: "7:73",
      words: [1, 10],
      words_total: 34,
      tokens: [],
      translation: null,
      translation_scope: null,
    },
  ],
};
const draft = (over: Partial<DecisionDraft> = {}): DecisionDraft => ({
  custom: { ref: "", range: [1, 1], valid: false },
  extend: [1, 3],
  t: null,
  ...over,
});
const ok = (item: ReadinessItem, pick: string, d = draft()) => {
  const built = buildDecision(item, pick, d);
  if (!built.ok) throw new Error(built.reason);
  // Le serveur relit la valeur avec le même lecteur strict : ce que l'écran envoie doit passer.
  expect(() => parseValue(built.kind, built.value, "value")).not.toThrow();
  return built;
};

describe("les choix proposés", () => {
  it("un incertain : un choix par candidat, un autre verset, pas du Coran", () => {
    expect(choicesFor(base).map((c) => c.id)).toEqual([
      "cand:0",
      "cand:1",
      "other",
      "exclude",
    ]);
    expect(choicesFor(base)[0]).toMatchObject({
      label: "C’est 11:61",
      key: "1",
    });
  });
  it("chaque sorte de passage a ses réponses", () => {
    expect(choicesFor({ ...base, type: "inferred" }).map((c) => c.id)).toEqual([
      "confirm",
      "exclude",
    ]);
    expect(choicesFor({ ...base, type: "cut" }).map((c) => c.id)).toEqual([
      "extend",
      "confirm",
      "exclude",
    ]);
    expect(choicesFor({ ...base, type: "approx" }).map((c) => c.id)).toEqual([
      "scope:verse",
      "scope:fragment",
      "scope:none",
    ]);
    expect(choicesFor({ ...base, type: "report" }).map((c) => c.id)).toEqual([
      "dismiss",
      "setref",
      "retime",
      "exclude",
    ]);
    expect(
      choicesFor({ ...base, type: "report", index: null }).map((c) => c.id),
    ).toEqual(["dismiss", "add"]);
  });
});

describe("la décision d'un choix", () => {
  it("choisir un candidat : sa référence et ses mots, sans temps tant qu'ils n'ont pas bougé", () => {
    expect(ok(base, "cand:1")).toMatchObject({
      kind: "choose",
      value: { ref: "7:73", words: [1, 10] },
    });
    expect(ok(base, "cand:1").value).not.toHaveProperty("t");
    expect(
      ok(base, "cand:0", draft({ t: [48.2, 62.6] })).value,
    ).not.toHaveProperty("t");
  });
  it("des temps déplacés accompagnent un choix", () => {
    expect(ok(base, "cand:0", draft({ t: [48.4, 62.6] })).value).toMatchObject({
      t: [48.4, 62.6],
    });
  });
  it("un autre verset exige un verset trouvé dans le corpus", () => {
    expect(buildDecision(base, "other", draft())).toMatchObject({ ok: false });
    const built = ok(
      base,
      "other",
      draft({ custom: { ref: "11:62", range: [1, 7], valid: true } }),
    );
    expect(built).toMatchObject({
      kind: "set_ref",
      value: { ref: "11:62", words: [1, 7] },
    });
  });
  it("poser un verset sur un signalement exige ses temps", () => {
    const report: ReadinessItem = {
      ...base,
      type: "report",
      index: null,
      t: [30, 33],
    };
    const built = ok(
      report,
      "add",
      draft({ custom: { ref: "112:3", range: [1, 4], valid: true } }),
    );
    expect(built.value).toMatchObject({
      ref: "112:3",
      words: [1, 4],
      t: [30, 33],
    });
  });
  it("étendre une coupure garde le même verset", () => {
    const cut: ReadinessItem = {
      ...base,
      type: "cut",
      ref: "17:74",
      words: [1, 3],
    };
    expect(ok(cut, "extend", draft({ extend: [1, 9] }))).toMatchObject({
      kind: "set_ref",
      value: { ref: "17:74", words: [1, 9] },
    });
  });
  it("confirmer, exclure, la portée de la traduction, le signalement faux", () => {
    expect(ok({ ...base, type: "inferred" }, "confirm").kind).toBe(
      "confirm_inferred",
    );
    expect(ok({ ...base, type: "cut" }, "confirm").kind).toBe(
      "confirm_partial",
    );
    expect(ok(base, "exclude").value).toEqual({ reason: "not_quran" });
    expect(ok({ ...base, type: "inferred" }, "exclude").value).toEqual({
      reason: "not_heard",
    });
    expect(ok({ ...base, type: "approx" }, "scope:none").value).toEqual({
      scope: "none",
    });
    expect(ok({ ...base, type: "report" }, "dismiss").kind).toBe(
      "dismiss_report",
    );
  });
  it("ajuster les temps sans les avoir déplacés est refusé", () => {
    const report: ReadinessItem = { ...base, type: "report" };
    expect(buildDecision(report, "retime", draft())).toMatchObject({
      ok: false,
    });
    expect(ok(report, "retime", draft({ t: [49, 62.6] })).value).toEqual({
      t: [49, 62.6],
    });
  });
  it("un choix inconnu est refusé", () => {
    expect(buildDecision(base, "n'importe quoi", draft())).toMatchObject({
      ok: false,
    });
    expect(buildDecision(base, "cand:9", draft())).toMatchObject({ ok: false });
  });
});

describe("rouvrir une décision", () => {
  const withDecision = (
    kind: string,
    value: object,
    over: Partial<ReadinessItem> = {},
  ) =>
    ({ ...base, ...over, decision: { kind, value } as never }) as ReadinessItem;
  it("retrouve le choix", () => {
    expect(pickOf(withDecision("choose", { ref: "7:73" }))).toBe("cand:1");
    expect(pickOf(withDecision("choose", { ref: "1:1" }))).toBe("other");
    expect(pickOf(withDecision("exclude", {}))).toBe("exclude");
    expect(
      pickOf(withDecision("translation_scope", { scope: "fragment" })),
    ).toBe("scope:fragment");
    expect(pickOf(withDecision("set_ref", {}, { type: "cut" }))).toBe("extend");
    expect(pickOf(base)).toBeNull();
  });
});
