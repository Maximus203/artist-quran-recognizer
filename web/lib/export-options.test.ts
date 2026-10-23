import { describe, expect, it } from "vitest";
import {
  DEFAULT_EXPORT_OPTIONS,
  exportFileName,
  resolveExportOptions,
} from "./export-options";

describe("options d'export", () => {
  it("les valeurs absentes prennent les défauts de la conception", () => {
    expect(resolveExportOptions({})).toEqual(DEFAULT_EXPORT_OPTIONS);
    expect(DEFAULT_EXPORT_OPTIONS).toMatchObject({
      format: "srt",
      content: "ar_fr",
      formulas: ["basmala"],
      repetitions: "keep",
      min_s: 1,
      max_s: 7,
      line_chars: 42,
      offset_ms: 0,
      rtl: true,
      strip_notes: false,
      show_ref: false,
      bom: false,
      policy: "omit",
      allow_unresolved: false,
    });
  });
  it.each([
    [{ format: "doc" }],
    [{ content: "tout" }],
    [{ offset_ms: 9000 }],
    [{ font: "KFGQPC Uthmanic Hafs" }],
    [{ max_s: 0.1 }],
    [{ inconnue: true }],
    [{ policy: "deviner" }],
  ])("refuse %j", (bad) => {
    expect(() => resolveExportOptions(bad)).toThrow();
  });
  it("refuse une durée maximale plus courte que la minimale", () => {
    expect(() => resolveExportOptions({ min_s: 5, max_s: 2 })).toThrow(
      /minimale/,
    );
  });
});

describe("nom du fichier", () => {
  const options = { format: "srt", content: "ar_fr" } as const;
  it("session.contenu.format, sans l'extension de l'audio", () => {
    expect(exportFileName("cours du soir.mp3", options)).toBe(
      "cours du soir.ar-fr.srt",
    );
    expect(exportFileName("a.mp3", { format: "ass", content: "ar" })).toBe(
      "a.ar.ass",
    );
    expect(exportFileName("a.mp3", { format: "json", content: "fr" })).toBe(
      "a.fr.json",
    );
  });
  it("assainit : jamais de séparateur de chemin ni de ..", () => {
    const name = exportFileName("../../etc/passwd\\x.mp3", options);
    expect(name).not.toMatch(/[\\/]|\.\./);
    expect(name.endsWith(".ar-fr.srt")).toBe(true);
  });
  it("garde 120 caractères au plus, extension comprise, et un nom par défaut", () => {
    expect(exportFileName("x".repeat(400), options).length).toBeLessThanOrEqual(
      120,
    );
    expect(exportFileName("???", options)).toBe("sous-titres.ar-fr.srt");
  });
  it("un nom choisi remplace celui de la session, sans doubler l'extension", () => {
    expect(exportFileName("a.mp3", options, "ma vidéo.srt")).toBe(
      "ma vidéo.ar-fr.srt",
    );
  });
});
