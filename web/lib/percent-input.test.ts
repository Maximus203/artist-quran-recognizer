import { describe, expect, it } from "vitest";
import {
  normalizeNumberText,
  percentRejection,
  readPercent,
} from "./percent-input";

const ok = (text: string) => {
  const reading = readPercent(text);
  if (!reading.ok) throw new Error(`« ${text} » devrait être lu`);
  return reading.percent;
};

describe("readPercent : ce qu'un champ en pourcents sait lire", () => {
  it("les nombres ordinaires, avec point ou virgule", () => {
    expect(ok("30")).toBe(30);
    expect(ok("12,5")).toBe(12.5);
    expect(ok("12.5")).toBe(12.5);
    expect(ok(".5")).toBe(0.5);
    expect(ok("  42  ")).toBe(42);
    expect(ok("0")).toBe(0);
    expect(ok("1e1")).toBe(10);
  });

  it("le signe, y compris le vrai signe moins", () => {
    expect(ok("-5")).toBe(-5);
    expect(ok("−5")).toBe(-5);
    expect(ok("+7")).toBe(7);
  });

  it("l'unité tapée à la fin est permise", () => {
    expect(ok("30 %")).toBe(30);
    expect(ok("30%")).toBe(30);
    expect(ok("12,5 %")).toBe(12.5);
  });

  it("les chiffres arabo-indiens et persans sont lus (QA 3, P4)", () => {
    expect(ok("٣٠")).toBe(30);
    expect(ok("٣٫٥")).toBe(3.5);
    expect(ok("٣٠٪")).toBe(30);
    expect(ok("۱۲")).toBe(12);
    expect(ok("٠")).toBe(0);
  });

  it("les chiffres pleine chasse et l'espace insécable aussi", () => {
    expect(ok("３０")).toBe(30);
    expect(ok("30 %")).toBe(30);
  });

  it("un champ vide n'est pas un zéro : il n'est pas lu", () => {
    expect(readPercent("")).toEqual({ ok: false, reason: "empty" });
    expect(readPercent("   ")).toEqual({ ok: false, reason: "empty" });
    expect(readPercent("%")).toEqual({ ok: false, reason: "empty" });
  });

  it("le reste n'est pas lu : jamais un NaN ni un Infinity appliqué", () => {
    for (const text of [
      "abc",
      "30 pour cent",
      "😀",
      "NaN",
      "Infinity",
      "-Infinity",
      "1e999",
      "1,2,3",
      "--5",
      "5-",
      "1 2",
      "0x10",
      "30 %%",
      "٣٠ abc",
      "١٢٣abc",
    ])
      expect(readPercent(text), text).toEqual({
        ok: false,
        reason: "unreadable",
      });
  });
});

describe("percentRejection", () => {
  it("dit ce qui n'est pas lu et la valeur gardée", () => {
    expect(percentRejection("Gauche", "abc", "unreadable", 30)).toBe(
      "« abc » n’est pas un nombre. Gauche reste à 30 %.",
    );
    expect(percentRejection("Haut", "", "empty", 12.5)).toBe(
      "Le champ « Haut » était vide. Haut reste à 12,5 %.",
    );
  });

  it("raccourcit un long texte et ne garde qu'une ligne", () => {
    const message = percentRejection(
      "Largeur",
      `${"x".repeat(500)}\n\nsuite`,
      "unreadable",
      50,
    );
    expect(message.length).toBeLessThan(80);
    expect(message).not.toContain("\n");
  });
});

describe("normalizeNumberText", () => {
  it("ne laisse que de l'ASCII pour les nombres, et ne touche pas au reste", () => {
    expect(normalizeNumberText("٣٫٥")).toBe("3.5");
    expect(normalizeNumberText("a,b")).toBe("a.b");
    expect(normalizeNumberText("abc")).toBe("abc");
  });
});
