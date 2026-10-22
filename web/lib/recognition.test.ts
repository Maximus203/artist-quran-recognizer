import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { activeIntervals, formatTime, parseRecognition } from "./recognition";

const base = {
  schema: "aqr.recognition/1",
  source: { file: "a.wav", sha256: "a".repeat(64), duration_s: 62 },
  engine: {
    asr: "whisper",
    segmenter: "recitation",
    matcher: "flow",
    decoder: "v2",
    constrained: false,
    corpus: "tanzil",
  },
  decoder: {},
  timing: {},
  windows: 1,
  warnings: [],
  intervals: [
    {
      kind: "verse",
      ref: "1:1",
      words: [1, 2],
      partial: false,
      status: "recognized",
      t: [0, 2],
      time_interpolated: false,
      confidence: 0.9,
      candidates: [],
      repetition: false,
      text: "بِسْمِ اللَّهِ",
      translation: null,
    },
    { kind: "abstention", reason: "silence", t: [2, 5], best_score: null },
    {
      kind: "verse",
      ref: "1:2",
      words: [1, 2],
      partial: false,
      status: "inferred",
      t: [2, 5],
      time_interpolated: true,
      confidence: 0.4,
      candidates: [],
      repetition: false,
      text: "الْحَمْدُ لِلَّهِ",
      translation: null,
    },
    {
      kind: "verse",
      ref: null,
      words: null,
      partial: false,
      status: "uncertain",
      t: null,
      time_interpolated: false,
      confidence: 0.2,
      candidates: ["1:3"],
      repetition: false,
      text: null,
      translation: null,
    },
  ],
};

describe("contrat recognition", () => {
  it("garde la riwaya supposée (non vérifiée) et accepte un ancien résultat sans elle", () => {
    const riwaya = {
      assumed: "hafs",
      verified: false,
      notice: "Riwaya supposée Hafs",
    };
    expect(parseRecognition({ ...base, riwaya }).riwaya).toEqual(riwaya);
    expect(parseRecognition(base).riwaya).toBeUndefined();
  });
  it("conserve les occurrences et le chevauchement", () => {
    const parsed = parseRecognition(base);
    expect(activeIntervals(parsed.intervals, 2).map((i) => i.kind)).toEqual([
      "abstention",
      "verse",
    ]);
    expect(activeIntervals(parsed.intervals, 5)).toEqual([]);
    expect(parsed.intervals[3].t).toBeNull();
  });
  it("rejette un hash erroné, une borne hors durée et un nombre non fini", () => {
    expect(() =>
      parseRecognition({ ...base, source: { ...base.source, sha256: "bad" } }),
    ).toThrow();
    expect(() =>
      parseRecognition({
        ...base,
        intervals: [
          {
            kind: "abstention",
            reason: "silence",
            t: [0, 63],
            best_score: null,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseRecognition({
        ...base,
        source: { ...base.source, duration_s: Infinity },
      }),
    ).toThrow();
  });
  describe("zones non coraniques : basmala affichée comme un verset", () => {
    const basmala = {
      kind: "non_quran",
      label: "basmala",
      t: [2, 5],
      basmala: true,
      ref: "1:1",
      text: "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ",
      translation: {
        text: "Au nom d'Allah",
        translation_id: "french_hameedullah",
        version: "1",
        attribution: "QuranEnc",
        scope: "verse",
      },
    };
    const parse = (...intervals: unknown[]) =>
      parseRecognition({ ...base, intervals });

    it("lit la basmala avec son texte, sa référence 1:1 et sa traduction", () => {
      const item = parse(basmala).intervals[0];
      expect(item).toMatchObject({
        kind: "non_quran",
        basmala: true,
        ref: "1:1",
        text: basmala.text,
      });
      expect(
        item.kind === "non_quran" && item.translation?.translation_id,
      ).toBe("french_hameedullah");
    });
    it("lit une basmala expurgée (sans texte ni traduction) et l'ancien format", () => {
      const { text, translation, ...light } = basmala;
      void text;
      void translation;
      expect(parse(light).intervals[0]).toMatchObject({ basmala: true });
      const old = parse({ kind: "non_quran", label: "takbir", t: [1, 2] })
        .intervals[0];
      expect(old).toEqual({ kind: "non_quran", label: "takbir", t: [1, 2] });
    });
    it("lit le libellé arabe d'une formule", () => {
      const item = parse({
        kind: "non_quran",
        label: "amin",
        t: [1, 2],
        label_ar: "آمين",
      }).intervals[0];
      expect(item).toMatchObject({ label_ar: "آمين" });
      expect(item.kind === "non_quran" && item.text).toBeUndefined();
    });
    it("rejette une zone incohérente : seule la basmala 1:1 porte un texte du Mushaf (I1)", () => {
      const bad = [
        { ...basmala, ref: "2:255" },
        { ...basmala, label: "takbir" },
        { ...basmala, basmala: false },
        { ...basmala, label_ar: "آمين" },
        { kind: "non_quran", label: "takbir", t: [1, 2], text: "الله أكبر" },
        { kind: "non_quran", label: "amin", t: [1, 2], ref: "1:1" },
        { ...basmala, text: "" },
        { ...basmala, basmala: "oui" },
        { kind: "non_quran", label: "amin", t: [1, 2], label_ar: "" },
        {
          kind: "non_quran",
          label: "takbir",
          t: [1, 2],
          translation: basmala.translation,
        },
      ];
      for (const item of bad) expect(() => parse(item)).toThrow();
    });
  });
  it("formate la frontière de minute", () => {
    expect(formatTime(59.999)).toBe("00:59.999");
    expect(formatTime(60)).toBe("01:00.000");
  });
  it("lit une vraie sortie expurgée du moteur sans inventer de texte", () => {
    const file = path.resolve(
      process.cwd(),
      "../docs/evaluation/trials/cli/lot1-05.recognition.redacted.json",
    );
    const parsed = parseRecognition(JSON.parse(readFileSync(file, "utf8")));
    expect(parsed.intervals.length).toBeGreaterThan(0);
    expect(
      parsed.intervals.find(
        (i) => i.kind === "verse" && i.status === "recognized" && !i.text,
      ),
    ).toBeTruthy();
  });
});
