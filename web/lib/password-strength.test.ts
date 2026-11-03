import { describe, expect, it } from "vitest";
import { passwordStrength, missingCharacters } from "./password-strength";

describe("passwordStrength", () => {
  it("trop court sous le minimum, avec le décompte", () => {
    const s = passwordStrength("abc1234", "awa");
    expect(s.level).toBe(0);
    expect(s.label).toBe("Trop court (7/12)");
  });
  it("acceptable à partir du minimum", () => {
    expect(passwordStrength("xqzvtkwhrpdm", "awa").level).toBe(1);
    expect(passwordStrength("xqzvtkwhrpdm", "awa").label).toBe("Acceptable");
  });
  it("bon à 14 caractères ou trois classes ; solide à 18, ou 16 avec trois classes, ou quatre mots", () => {
    expect(passwordStrength("xqzvtkwhrpdmcb", "awa").level).toBe(2);
    expect(passwordStrength("Xqzvtk12whrp", "awa").level).toBe(2);
    expect(passwordStrength("xqzvtkwhrpdmcbnfls", "awa").level).toBe(3);
    expect(passwordStrength("Xqzvtkwhrp12cbn!", "awa").level).toBe(3);
    expect(passwordStrength("le ciel est bleu", "awa").level).toBe(3);
  });
  it("un mot de passe identique au pseudonyme n'est jamais plus que trop faible", () => {
    const s = passwordStrength("moussa_diallo", "Moussa_Diallo");
    expect(s.level).toBe(0);
    expect(s.label).toBe("Identique au pseudonyme");
  });
  it("courant ou prévisible : refusé, avec le motif", () => {
    expect(passwordStrength("Password123456", "awa")).toEqual({
      level: 0,
      label: "Trop courant ou prévisible",
    });
    expect(passwordStrength("abcdefghijklmnop", "awa").level).toBe(0);
    expect(passwordStrength("moussa-et-mon-chat-2026", "moussa").label).toBe(
      "Contient le pseudonyme",
    );
  });
  it("vide : pas de jauge", () => {
    expect(passwordStrength("", "awa").level).toBe(0);
    expect(passwordStrength("", "awa").label).toBe("");
  });
});

describe("missingCharacters", () => {
  it("dit combien il en manque", () => {
    expect(missingCharacters("abc1234")).toBe(5);
    expect(missingCharacters("abcdefghijkl")).toBe(0);
  });
});
