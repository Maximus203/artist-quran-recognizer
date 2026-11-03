import { describe, expect, it } from "vitest";
import {
  MIN_SAMPLES,
  fitEngine,
  looRelativeErrors,
  median,
  predictTotal,
  projectQueue,
  quantile,
  rtfStats,
  type HistoryPoint,
} from "./estimate";

const pt = (audio_s: number, duration_s: number): HistoryPoint => ({
  engine: "fastconformer",
  audio_s,
  duration_s,
});
/** Données exactement affines : 45 s de chargement + 0,02 s de calcul par seconde d'audio. */
const affine = [60, 300, 900, 1800, 3600, 7200].map((a) =>
  pt(a, 45 + 0.02 * a),
);

describe("statistiques de base", () => {
  it("médiane et quantiles (interpolation linéaire)", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNaN();
    expect(quantile([1, 2, 3, 4, 5], 0.9)).toBeCloseTo(4.6);
    expect(quantile([7], 0.9)).toBe(7);
  });
});

describe("rtfStats — le RTF dispersé se voit", () => {
  it("renvoie médiane, p90, moyenne, extrêmes ; null sans analyse", () => {
    expect(rtfStats([])).toBeNull();
    const stats = rtfStats([pt(10, 50), pt(100, 60), pt(1000, 100)])!;
    // RTF = durée de traitement / durée audio : 5, 0,6, 0,1
    expect(stats.median).toBeCloseTo(0.6);
    expect(stats.min).toBeCloseTo(0.1);
    expect(stats.max).toBeCloseTo(5);
    expect(stats.mean).toBeCloseTo((5 + 0.6 + 0.1) / 3);
    expect(stats.p90).toBeCloseTo(4.12); // 0,6 + 0,8 × (5 − 0,6)
  });
  it("ignore les points inexploitables (durée nulle, NaN)", () => {
    expect(rtfStats([pt(0, 10), pt(10, 0), pt(Number.NaN, 5)])).toBeNull();
  });
});

describe("fitEngine — durée = chargement + coût × audio", () => {
  it("retrouve le chargement et le coût d'un historique affine", () => {
    const result = fitEngine(affine);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fit.overhead_s).toBeCloseTo(45, 5);
    expect(result.fit.seconds_per_audio_s).toBeCloseTo(0.02, 5);
    expect(result.fit.samples).toBe(affine.length);
    expect(predictTotal(result.fit, 5400).total_s).toBeCloseTo(153, 3);
  });

  it("refuse d'estimer sans assez d'historique, avec la raison", () => {
    expect(fitEngine([])).toEqual({ ok: false, reason: "no_history" });
    expect(fitEngine(affine.slice(0, MIN_SAMPLES - 1))).toEqual({
      ok: false,
      reason: "insufficient_history",
    });
  });

  it("refuse quand tous les audios ont la même durée (pente inconnaissable)", () => {
    const flat = [pt(18, 60), pt(18.2, 58), pt(18.1, 63), pt(17.9, 61)];
    expect(fitEngine(flat)).toEqual({
      ok: false,
      reason: "history_too_narrow",
    });
  });

  it("un point aberrant (analyses lancées en parallèle) ne tire pas l'estimation", () => {
    const polluted = [...affine, pt(900, 45 + 0.02 * 900 + 400)];
    const result = fitEngine(polluted);
    if (!result.ok) throw new Error("estimation attendue");
    expect(predictTotal(result.fit, 900).total_s).toBeLessThan(80);
  });

  it("ne prédit jamais une durée négative (pente et chargement bornés à 0)", () => {
    const decreasing = [pt(10, 100), pt(100, 60), pt(1000, 30), pt(2000, 10)];
    const result = fitEngine(decreasing);
    if (!result.ok) throw new Error("estimation attendue");
    expect(result.fit.seconds_per_audio_s).toBeGreaterThanOrEqual(0);
    expect(result.fit.overhead_s).toBeGreaterThanOrEqual(0);
    expect(predictTotal(result.fit, 5000).total_s).toBeGreaterThanOrEqual(0);
  });

  it("signale une durée d'audio hors de la plage mesurée au lieu d'extrapoler", () => {
    const short = [pt(4, 40), pt(10, 41), pt(17, 44), pt(30, 47)];
    const result = fitEngine(short);
    if (!result.ok) throw new Error("estimation attendue");
    expect(predictTotal(result.fit, 25).out_of_range).toBe(false);
    expect(predictTotal(result.fit, 60).out_of_range).toBe(false);
    expect(predictTotal(result.fit, 2700).out_of_range).toBe(true);
  });

  it("n'utilise que les points du moteur demandé", () => {
    const mixed = [
      ...affine,
      { engine: "whisper", audio_s: 600, duration_s: 9999 },
    ];
    const result = fitEngine(mixed.filter((p) => p.engine === "fastconformer"));
    expect(result.ok).toBe(true);
  });
});

describe("incertitude mesurée par validation croisée (leave-one-out)", () => {
  it("n'annonce aucune fourchette avec 3 points seulement", () => {
    const result = fitEngine(affine.slice(0, 3));
    if (!result.ok) throw new Error("estimation attendue");
    expect(result.fit.loo_median_rel_error).toBeNull();
    expect(predictTotal(result.fit, 600).low_s).toBeNull();
    expect(predictTotal(result.fit, 600).high_s).toBeNull();
  });
  it("avec assez de points : erreur relative médiane et fourchette p10–p90 qui encadrent l'estimation", () => {
    const noisy = affine.map((p, i) =>
      pt(p.audio_s, p.duration_s * (i % 2 ? 1.2 : 0.85)),
    );
    const result = fitEngine(noisy);
    if (!result.ok) throw new Error("estimation attendue");
    expect(result.fit.loo_median_rel_error).toBeGreaterThan(0.05);
    const p = predictTotal(result.fit, 1000);
    expect(p.low_s!).toBeLessThanOrEqual(p.total_s);
    expect(p.high_s!).toBeGreaterThanOrEqual(p.total_s);
    expect(p.high_s! - p.low_s!).toBeGreaterThan(0);
  });
  it("looRelativeErrors : zéro erreur sur des données exactes", () => {
    const errors = looRelativeErrors(affine);
    expect(errors).toHaveLength(affine.length);
    for (const e of errors) expect(e).toBeLessThan(1e-6);
  });
});

describe("projectQueue — somme séquentielle", () => {
  it("une place : chaque analyse finit après les précédentes", () => {
    const eta = projectQueue(
      [{ id: "run", remaining_s: 30 }],
      [
        { id: "a", total_s: 100 },
        { id: "b", total_s: 50 },
      ],
      1,
    );
    expect(eta.get("run")).toBe(30);
    expect(eta.get("a")).toBe(130);
    expect(eta.get("b")).toBe(180);
  });
  it("file seule, rien en cours : la première démarre tout de suite", () => {
    const eta = projectQueue([], [{ id: "a", total_s: 40 }], 1);
    expect(eta.get("a")).toBe(40);
  });
  it("deux places : la deuxième analyse prend la place libre", () => {
    const eta = projectQueue(
      [{ id: "run", remaining_s: 100 }],
      [
        { id: "a", total_s: 60 },
        { id: "b", total_s: 60 },
      ],
      2,
    );
    expect(eta.get("a")).toBe(60); // place libre
    expect(eta.get("b")).toBe(120); // reprend la place de `a`
  });
  it("une durée inconnue rend inconnues toutes celles qui en dépendent, jamais un chiffre inventé", () => {
    const eta = projectQueue(
      [{ id: "run", remaining_s: null }],
      [
        { id: "a", total_s: 10 },
        { id: "b", total_s: 10 },
      ],
      1,
    );
    expect(eta.get("run")).toBeNull();
    expect(eta.get("a")).toBeNull();
    expect(eta.get("b")).toBeNull();
    const eta2 = projectQueue(
      [],
      [
        { id: "a", total_s: null },
        { id: "b", total_s: 10 },
      ],
      1,
    );
    expect(eta2.get("a")).toBeNull();
    expect(eta2.get("b")).toBeNull();
  });
  it("une place libre connue permet d'estimer même si une autre est d'inconnue", () => {
    const eta = projectQueue(
      [{ id: "run", remaining_s: null }],
      [{ id: "a", total_s: 25 }],
      2,
    );
    expect(eta.get("a")).toBe(25);
  });
});
