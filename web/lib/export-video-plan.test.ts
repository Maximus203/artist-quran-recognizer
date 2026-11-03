import { describe, expect, it } from "vitest";
import { MAX_RANGES } from "./export-video-ranges";
import { suggestRanges, type SuggestTiming } from "./export-video-suggest";
import {
  addVerse,
  fromSuggestions,
  isWhole,
  moveDown,
  moveUp,
  nameFromRefs,
  rangeFacts,
  reflow,
  removeRange,
  snapTargets,
  suggestionNear,
  verseAt,
  wholeAudio,
  type PlanContext,
  type PlanRange,
} from "./export-video-plan";

// Remplissage neutre : aucune référence réelle ni aucun texte, seulement des temps.
const intervals: SuggestTiming[] = [
  { kind: "non_quran", t: [0, 4] },
  { kind: "verse", ref: "R:1", status: "recognized", t: [5, 10] },
  { kind: "verse", ref: "R:2", status: "inferred", t: [12, 18] },
  { kind: "verse", ref: "R:3", status: "uncertain", t: [20, 24] },
  { kind: "verse", ref: "R:4", status: "recognized", t: [30, 36] },
];
const ctx = (before = 0.6, after = 0.4): PlanContext => ({
  intervals,
  duration: 40,
  peaks: null,
  padding: { before, after, snap: true },
});

describe("raccourcis", () => {
  it("« Tout l'audio » : une seule plage 0 → durée, automatique", () => {
    const [r] = [wholeAudio(ctx(), 1)];
    expect(r).toMatchObject({ id: 1, start: 0, end: 40, auto: true });
    expect(isWhole(r, 40)).toBe(true);
  });
  it("« Un verset = une vidéo » : une plage par verset proposé, souffle compris, jamais l'incertain", () => {
    const ranges = fromSuggestions(ctx(), 1);
    expect(ranges.map((r) => r.name)).toEqual(["R:1", "R:2", "R:4"]);
    const expected = suggestRanges(intervals, 40, null, {
      leadIn: 0.6,
      tailOut: 0.4,
      group: "verse",
    });
    expect(ranges.map((r) => [r.start, r.end])).toEqual(
      expected.map((s) => [s.start, s.end]),
    );
    expect(ranges.every((r) => r.auto)).toBe(true);
    expect(new Set(ranges.map((r) => r.id)).size).toBe(3);
  });
  it("ne dépasse jamais le nombre maximal de plages", () => {
    const many: SuggestTiming[] = Array.from({ length: 70 }, (_, i) => ({
      kind: "verse",
      ref: `R:${i}`,
      status: "recognized",
      t: [i * 3, i * 3 + 2],
    }));
    expect(
      fromSuggestions({ ...ctx(), intervals: many, duration: 300 }, 1),
    ).toHaveLength(MAX_RANGES);
  });
  it("« Ajouter ce verset » ajoute la plage protégée du verset et respecte le maximum", () => {
    const list = addVerse([], ctx(), 30.5, 7);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 7, name: "R:4", auto: true });
    const full = Array.from({ length: MAX_RANGES }, (_, i) => ({
      ...list[0],
      id: i,
    }));
    expect(addVerse(full, ctx(), 30.5, 99)).toBe(full);
  });
  it("« Ajouter une plage » prend le passage le plus proche du centre de la loupe", () => {
    expect(suggestionNear(ctx(), 26)?.refs).toEqual(["R:4"]);
    expect(suggestionNear(ctx(), 7)?.refs).toEqual(["R:1"]);
    // Déjà dans la liste : on propose le suivant, jamais un doublon.
    const taken = addVerse([], ctx(), 7, 1);
    expect(suggestionNear(ctx(), 7, taken)?.refs).toEqual(["R:2"]);
    const all = fromSuggestions(ctx(), 1);
    expect(suggestionNear(ctx(), 7, all)).toBeNull();
  });
});

describe("souffle", () => {
  it("les plages automatiques suivent un nouveau souffle, celles retouchées à la main ne bougent pas", () => {
    const ranges = fromSuggestions(ctx(), 1);
    const touched: PlanRange[] = ranges.map((r, i) =>
      i === 0 ? { ...r, start: 4.5, auto: false } : r,
    );
    const next = reflow(touched, ctx(1, 1));
    expect(next[0].start).toBe(4.5);
    expect(next[2].end).toBeGreaterThan(ranges[2].end);
    expect(next[2].start).toBeLessThan(ranges[2].start);
    expect(next.map((r) => r.id)).toEqual(ranges.map((r) => r.id));
  });
  it("« Tout l'audio » reste tout l'audio", () => {
    const whole = wholeAudio(ctx(), 1);
    expect(reflow([whole], ctx(2, 2))[0]).toEqual(whole);
  });
});

describe("liste", () => {
  const list: PlanRange[] = [1, 2, 3].map((id) => ({
    id,
    start: id * 10,
    end: id * 10 + 5,
    name: `n${id}`,
    auto: false,
    anchor: null,
  }));
  it("monte, descend et retire sans perdre les autres", () => {
    expect(moveUp(list, 2).map((r) => r.id)).toEqual([2, 1, 3]);
    expect(moveUp(list, 1)).toBe(list);
    expect(moveDown(list, 2).map((r) => r.id)).toEqual([1, 3, 2]);
    expect(moveDown(list, 3)).toBe(list);
    expect(removeRange(list, 2).map((r) => r.id)).toEqual([1, 3]);
  });
});

describe("constats d'une plage", () => {
  const base = { id: 1, name: "", auto: false, anchor: null };
  it("compte les passages et ceux à vérifier", () => {
    const facts = rangeFacts({ ...base, start: 4, end: 25 }, intervals, []);
    expect(facts.verses).toBe(3);
    expect(facts.toCheck).toBe(2);
    expect(facts.cutsVoice).toBe(false);
  });
  it("signale un bord posé dans une voix", () => {
    expect(
      rangeFacts({ ...base, start: 7, end: 11 }, intervals, []).cutsVoice,
    ).toBe(true);
  });
  it("signale le chevauchement avec une autre plage (numéro dans la liste)", () => {
    const a = { ...base, id: 1, start: 4, end: 11 };
    const b = { ...base, id: 2, start: 10, end: 19 };
    expect(rangeFacts(a, intervals, [a, b]).overlapsWith).toBe(2);
    expect(
      rangeFacts(a, intervals, [a, { ...b, start: 11 }]).overlapsWith,
    ).toBeNull();
  });
});

describe("repères", () => {
  it("l'aimant vise les bords protégés de chaque verset, triés", () => {
    const t = snapTargets(ctx());
    expect(t).toEqual([...t].sort((a, b) => a - b));
    expect(t.length).toBe(6);
  });
  it("trouve le passage sous le doigt, même incertain (mais sans le proposer)", () => {
    expect(verseAt(intervals, 7)?.ref).toBe("R:1");
    expect(verseAt(intervals, 22)?.status).toBe("uncertain");
    expect(verseAt(intervals, 27)).toBeNull();
  });
});

describe("noms par défaut", () => {
  it("viennent des références du résultat (jamais inventées)", () => {
    expect(nameFromRefs(["2:255"])).toBe("2:255");
    expect(nameFromRefs(["2:255", "2:256", "2:257"])).toBe("2:255-257");
    expect(nameFromRefs(["2:286", "3:1"])).toBe("2:286-3:1");
    expect(nameFromRefs([])).toBe("");
  });
});
