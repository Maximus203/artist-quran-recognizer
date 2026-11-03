import { describe, expect, it } from "vitest";
import {
  REVIEW_PRESETS,
  allPresetIds,
  legacyTypeOf,
  presetLabel,
} from "./review-presets";

describe("REVIEW_PRESETS (configuration centralisée)", () => {
  it("compte 7 familles et 23 puces", () => {
    expect(REVIEW_PRESETS).toHaveLength(7);
    expect(allPresetIds()).toHaveLength(23);
  });
  it("garde les familles dans l'ordre de la spécification", () => {
    expect(REVIEW_PRESETS.map((f) => f.id)).toEqual([
      "verse",
      "bounds",
      "detection",
      "formula",
      "recitation",
      "audio",
      "other",
    ]);
  });
  it("a des identifiants uniques, stables (snake_case) et des libellés non vides", () => {
    const ids = allPresetIds();
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
    for (const family of REVIEW_PRESETS) {
      expect(family.label.trim()).not.toBe("");
      for (const item of family.items) expect(item.label.trim()).not.toBe("");
    }
  });
  it("ouvre par défaut Verset et Limites seulement", () => {
    expect(
      REVIEW_PRESETS.filter((f) => f.defaultOpen).map((f) => f.id),
    ).toEqual(["verse", "bounds"]);
  });
  it("contient les 5 ajouts validés par le mainteneur", () => {
    const ids = allPresetIds();
    for (const added of [
      "extra_verse",
      "abstention_wrong",
      "takbir_amin",
      "reciter_error",
      "overlap",
    ])
      expect(ids).toContain(added);
  });
});

describe("presetLabel", () => {
  it("renvoie le libellé configuré", () => {
    expect(presetLabel("wrong_verse")).toBe("Verset faux");
    expect(presetLabel("display_offset")).toBe("Affichage décalé de la voix");
  });
  it("affiche tel quel un identifiant inconnu (liste modifiée depuis)", () => {
    expect(presetLabel("ancienne_puce")).toBe("ancienne_puce");
  });
});

describe("legacyTypeOf (exports existants inchangés)", () => {
  it("dérive le type historique du premier tag", () => {
    expect(legacyTypeOf(["wrong_verse"])).toBe("wrong_verse");
    expect(legacyTypeOf(["missing_verse", "start_late"])).toBe("missing_verse");
    expect(legacyTypeOf(["repetition_missed"])).toBe("repetition");
  });
  it("range les bornes et le décalage sous « timing »", () => {
    for (const tag of [
      "start_early",
      "start_late",
      "end_early",
      "end_late",
      "display_offset",
    ])
      expect(legacyTypeOf([tag])).toBe("timing");
  });
  it("range tout le reste sous « other », y compris sans tag ou tag inconnu", () => {
    expect(legacyTypeOf([])).toBe("other");
    expect(legacyTypeOf(["noise"])).toBe("other");
    expect(legacyTypeOf(["extra_verse"])).toBe("other");
    expect(legacyTypeOf(["inconnu_futur"])).toBe("other");
  });
});
