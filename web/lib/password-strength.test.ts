import { describe, expect, it } from "vitest";
import { passwordStrength, missingCharacters } from "./password-strength";

describe("passwordStrength", () => {
  it("trop court sous le minimum, avec le décompte", () => {
    const s = passwordStrength("abc1234", "awa");
    expect(s.level).toBe(0);
    expect(s.label).toBe("Trop court (7/10)");
  });
  it("acceptable à partir du minimum", () => {
    expect(passwordStrength("abcdefghij", "awa").level).toBe(1);
    expect(passwordStrength("abcdefghij", "awa").label).toBe("Acceptable");
  });
  it("solide à 16 caractères, ou 12 avec trois classes, ou une phrase de trois mots", () => {
    expect(passwordStrength("abcdefghijklmnop", "awa").level).toBe(3);
    expect(passwordStrength("Abcdef12ghij", "awa").level).toBe(3);
    expect(passwordStrength("le ciel est bleu", "awa").level).toBe(3);
    expect(passwordStrength("Abcdefghijkl", "awa").level).toBe(2);
  });
  it("un mot de passe identique au pseudonyme n'est jamais plus que trop faible", () => {
    const s = passwordStrength("moussa_diallo", "Moussa_Diallo");
    expect(s.level).toBe(0);
    expect(s.label).toBe("Identique au pseudonyme");
  });
  it("vide : pas de jauge", () => {
    expect(passwordStrength("", "awa").level).toBe(0);
    expect(passwordStrength("", "awa").label).toBe("");
  });
});

describe("missingCharacters", () => {
  it("dit combien il en manque", () => {
    expect(missingCharacters("abc1234")).toBe(3);
    expect(missingCharacters("abcdefghij")).toBe(0);
  });
});
