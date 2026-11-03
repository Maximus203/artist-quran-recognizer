import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_QURAN_FONT,
  QURAN_FONTS,
  isQuranFontId,
  resolveQuranFont,
} from "./quran-fonts";

describe("QURAN_FONTS", () => {
  it("propose les 4 polices, Hafs V30 en premier (choix du mainteneur)", () => {
    expect(QURAN_FONTS.map((f) => f.id)).toEqual([
      "kfgqpc-hafs",
      "amiri-quran",
      "scheherazade",
      "noto-naskh",
    ]);
  });
  it("marque Hafs V30 comme locale et les trois autres comme embarquées", () => {
    const sources = Object.fromEntries(
      QURAN_FONTS.map((f) => [f.id, f.source]),
    );
    expect(sources).toEqual({
      "kfgqpc-hafs": "local",
      "amiri-quran": "bundled",
      scheherazade: "bundled",
      "noto-naskh": "bundled",
    });
  });
  it("a pour défaut une police embarquée (OFL)", () => {
    expect(QURAN_FONTS.find((f) => f.id === DEFAULT_QURAN_FONT)?.source).toBe(
      "bundled",
    );
  });
});

describe("isQuranFontId", () => {
  it("valide un identifiant connu et refuse le reste", () => {
    expect(isQuranFontId("amiri-quran")).toBe(true);
    expect(isQuranFontId("comic-sans")).toBe(false);
    expect(isQuranFontId(42)).toBe(false);
  });
});

describe("resolveQuranFont (repli quand la police locale est absente)", () => {
  it("garde le choix quand la police est disponible", () => {
    expect(resolveQuranFont("kfgqpc-hafs", { "kfgqpc-hafs": true })).toBe(
      "kfgqpc-hafs",
    );
  });
  it("retombe sur la police embarquée par défaut quand Hafs V30 est absente", () => {
    expect(resolveQuranFont("kfgqpc-hafs", { "kfgqpc-hafs": false })).toBe(
      DEFAULT_QURAN_FONT,
    );
  });
  it("sans choix mémorisé : Hafs V30 si présente, sinon le défaut", () => {
    expect(resolveQuranFont(null, { "kfgqpc-hafs": true })).toBe("kfgqpc-hafs");
    expect(resolveQuranFont(null, { "kfgqpc-hafs": false })).toBe(
      DEFAULT_QURAN_FONT,
    );
    expect(resolveQuranFont(null, {})).toBe(DEFAULT_QURAN_FONT);
  });
});

describe("licence : aucune police « tous droits réservés » dans public/", () => {
  it("n'embarque pas KFGQPC", () => {
    const names = readdirSync(path.join(process.cwd(), "public", "fonts"));
    expect(names.filter((n) => /kfgqpc|hafs.*v30/i.test(n))).toEqual([]);
  });
  it("accompagne chaque police embarquée de son texte de licence OFL", () => {
    const names = readdirSync(path.join(process.cwd(), "public", "fonts"));
    const licences = names.filter((n) => n.startsWith("OFL-"));
    for (const font of [
      "AmiriQuran",
      "ScheherazadeNew",
      "NotoNaskhArabic",
      "InstrumentSerif",
      "AtkinsonHyperlegible",
      "AtkinsonHyperlegibleMono",
    ])
      expect(licences).toContain(`OFL-${font}.txt`);
  });
});
