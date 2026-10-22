import { describe, expect, it } from "vitest";
import {
  LEGACY_TESTER,
  MAX_RECENT_TESTERS,
  initialOf,
  rememberTester,
  sanitizeRecent,
  validateTester,
} from "./tester";

describe("validateTester", () => {
  it("accepte un pseudonyme simple et le rend nettoyé", () => {
    expect(validateTester("  Awa  ")).toEqual({ ok: true, value: "Awa" });
    expect(validateTester("awa-tel_2.0")).toEqual({
      ok: true,
      value: "awa-tel_2.0",
    });
    expect(validateTester("Moussa Diop")).toEqual({
      ok: true,
      value: "Moussa Diop",
    });
  });
  it("accepte les lettres accentuées et arabes", () => {
    expect(validateTester("Éloïse").ok).toBe(true);
    expect(validateTester("عائشة").ok).toBe(true);
  });
  it("refuse moins de 2 et plus de 24 caractères", () => {
    expect(validateTester("A").ok).toBe(false);
    expect(validateTester("a".repeat(25)).ok).toBe(false);
    expect(validateTester("a".repeat(24)).ok).toBe(true);
  });
  it("refuse une adresse e-mail (le @)", () => {
    const result = validateTester("awa@example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("e-mail");
  });
  it("refuse les caractères hors règle (balises, barres, emoji)", () => {
    expect(validateTester("<b>awa</b>").ok).toBe(false);
    expect(validateTester("awa/../x").ok).toBe(false);
    expect(validateTester("awa😀").ok).toBe(false);
  });
  it("refuse vide et espaces seuls", () => {
    expect(validateTester("").ok).toBe(false);
    expect(validateTester("    ").ok).toBe(false);
  });
});

describe("rememberTester", () => {
  it("place le dernier testeur en tête sans doublon", () => {
    expect(rememberTester(["Awa", "Moussa"], "Moussa")).toEqual([
      "Moussa",
      "Awa",
    ]);
  });
  it("ne garde que les 8 derniers", () => {
    const names = Array.from({ length: 10 }, (_, i) => `testeur-${i}`);
    expect(rememberTester(names, "nouveau")).toHaveLength(MAX_RECENT_TESTERS);
    expect(rememberTester(names, "nouveau")[0]).toBe("nouveau");
  });
});

describe("sanitizeRecent (lu depuis le stockage du navigateur)", () => {
  it("ignore tout ce qui n'est pas un pseudonyme valide", () => {
    expect(sanitizeRecent(["Awa", 12, "a@b.c", null, "Moussa", "x"])).toEqual([
      "Awa",
      "Moussa",
    ]);
  });
  it("renvoie une liste vide pour une valeur inattendue", () => {
    expect(sanitizeRecent("Awa")).toEqual([]);
    expect(sanitizeRecent(undefined)).toEqual([]);
  });
});

describe("initialOf / LEGACY_TESTER", () => {
  it("prend la première lettre en capitale", () => {
    expect(initialOf("awa")).toBe("A");
    expect(initialOf("")).toBe("?");
  });
  it("garde un nom pour les signalements d'avant le suivi des testeurs", () => {
    expect(validateTester(LEGACY_TESTER).ok).toBe(true);
  });
});
