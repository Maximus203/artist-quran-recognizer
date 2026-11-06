import { describe, expect, it } from "vitest";
import {
  freeSpeechByIndex,
  parseFreeSpeech,
  shownFreeSpeech,
} from "./free-speech";

const doc = (items: unknown[]) => ({
  schema: "aqr.free-speech/1",
  source: { recognition_sha256: "0".repeat(64) },
  engine: { transcriber: "a", translator: "b" },
  items,
});
const translated = (index: number, review: string) => ({
  index,
  t: [1, 5],
  status: "translated",
  transcript_ar: "اليوم نتحدث عن الصبر",
  translation_fr: "Aujourd'hui nous parlons de la patience.",
  confidence: 0.9,
  language: "ar",
  review,
});
const withheld = (index: number) => ({
  index,
  t: [6, 9],
  status: "withheld",
  reason: "quran_like",
});

describe("parseFreeSpeech", () => {
  it("lit un fichier valide", () => {
    const parsed = parseFreeSpeech(
      doc([translated(0, "pending"), withheld(1)]),
    );
    expect(parsed?.items).toHaveLength(2);
  });

  it("ignore tout le fichier si un passage retenu porte du texte (I3)", () => {
    const leaky = { ...withheld(1), transcript_ar: "قل هو الله أحد" };
    expect(parseFreeSpeech(doc([translated(0, "pending"), leaky]))).toBeNull();
  });

  it.each([
    ["autre schéma", { ...doc([]), schema: "x" }],
    ["raison inconnue", doc([{ ...withheld(0), reason: "inventée" }])],
    ["revue inconnue", doc([translated(0, "maybe")])],
    ["index en double", doc([withheld(0), withheld(0)])],
    [
      "traduction vide",
      doc([{ ...translated(0, "pending"), translation_fr: " " }]),
    ],
    ["pas un objet", "texte"],
  ])("refuse : %s", (_name, value) => {
    expect(parseFreeSpeech(value)).toBeNull();
  });
});

describe("shownFreeSpeech", () => {
  const items = freeSpeechByIndex(
    parseFreeSpeech(
      doc([
        translated(0, "approved"),
        translated(1, "pending"),
        translated(2, "rejected"),
        withheld(3),
      ]),
    ),
  );

  it("par défaut : seulement ce qui a été validé", () => {
    expect([...shownFreeSpeech(items, false).keys()]).toEqual([0]);
  });

  it("l'attente n'entre que sur choix explicite ; le rejet jamais", () => {
    expect([...shownFreeSpeech(items, true).keys()]).toEqual([0, 1]);
  });

  it("jamais un passage retenu", () => {
    expect(shownFreeSpeech(items, true).has(3)).toBe(false);
  });

  it("sans fichier : rien", () => {
    expect(shownFreeSpeech(null, true).size).toBe(0);
    expect(freeSpeechByIndex(null).size).toBe(0);
  });
});
