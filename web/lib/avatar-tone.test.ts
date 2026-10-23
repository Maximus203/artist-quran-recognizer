import { describe, expect, it } from "vitest";
import { AVATAR_TONES, avatarInitial, avatarTone } from "./avatar-tone";

describe("avatarTone : couleur stable dérivée du pseudo", () => {
  it("renvoie toujours un indice valide", () => {
    for (const name of ["Cherif", "Awa", "مريم", "😀", "a", "x".repeat(24)]) {
      const tone = avatarTone(name);
      expect(Number.isInteger(tone)).toBe(true);
      expect(tone).toBeGreaterThanOrEqual(0);
      expect(tone).toBeLessThan(AVATAR_TONES);
    }
  });

  it("est stable : même pseudo, même couleur, à chaque appel", () => {
    expect(avatarTone("Cherif")).toBe(avatarTone("Cherif"));
  });

  it("ignore la casse, les espaces superflus et la forme Unicode (comme l'unicité des pseudos)", () => {
    expect(avatarTone("  CHERIF ")).toBe(avatarTone("cherif"));
    expect(avatarTone("Jean   Paul")).toBe(avatarTone("jean paul"));
    expect(avatarTone("élise")).toBe(avatarTone("élise"));
  });

  it("répartit des pseudos différents sur plusieurs couleurs", () => {
    const names = [
      "Cherif",
      "Awa",
      "Moussa",
      "Fatou",
      "Ibrahima",
      "Mariama",
      "Omar",
      "Khadija",
    ];
    expect(new Set(names.map(avatarTone)).size).toBeGreaterThanOrEqual(4);
  });
});

describe("avatarInitial", () => {
  it("prend la première lettre en capitale", () => {
    expect(avatarInitial("cherif")).toBe("C");
    expect(avatarInitial("  awa")).toBe("A");
    expect(avatarInitial("élise")).toBe("É");
  });

  it("garde un caractère entier (arabe, emoji hors plan de base)", () => {
    expect(avatarInitial("مريم")).toBe("م");
    expect(avatarInitial("😀 ami")).toBe("😀");
  });

  it("retombe sur « ? » quand il n'y a rien à afficher", () => {
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial("   ")).toBe("?");
  });
});
