import { describe, expect, it } from "vitest";
import { parseFreeSpeech } from "./free-speech";
import { freeSpeechForVideo } from "./export-video-free-speech";

const item = (index: number, review: string) => ({
  index,
  t: [1, 5],
  status: "translated",
  transcript_ar: "اليوم نتحدث عن الصبر",
  translation_fr: "Aujourd'hui nous parlons de la patience.",
  confidence: 0.9,
  language: "ar",
  review,
});
const doc = parseFreeSpeech({
  schema: "aqr.free-speech/1",
  source: { recognition_sha256: "0".repeat(64) },
  engine: { transcriber: "a", translator: "b" },
  items: [
    item(0, "approved"),
    item(1, "pending"),
    item(2, "rejected"),
    { index: 3, t: [6, 9], status: "withheld", reason: "quran_like" },
  ],
});

describe("freeSpeechForVideo", () => {
  it("désactivée par défaut : rien", () => {
    expect(freeSpeechForVideo(doc, "off")).toBeNull();
  });
  it("validées seulement", () => {
    expect([...(freeSpeechForVideo(doc, "approved")?.keys() ?? [])]).toEqual([
      0,
    ]);
  });
  it("toutes, sauf rejetées et retenues", () => {
    expect([...(freeSpeechForVideo(doc, "all")?.keys() ?? [])]).toEqual([0, 1]);
  });
  it("sans fichier : rien", () => {
    expect(freeSpeechForVideo(null, "all")).toBeNull();
  });
});
