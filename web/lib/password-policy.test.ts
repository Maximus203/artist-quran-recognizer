import { describe, expect, it } from "vitest";
import { PASSWORD_MAX, PASSWORD_MIN, checkPassword } from "./password-policy";

const refused = (password: string, username = "awa") => {
  const result = checkPassword(password, username);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.message;
};

describe("politique de mot de passe", () => {
  it("12 à 128 caractères", () => {
    expect(PASSWORD_MIN).toBe(12);
    expect(PASSWORD_MAX).toBe(128);
    expect(refused("Court-1234")).toMatch(/au moins 12/);
    expect(refused("a".repeat(129) + "Zq")).toMatch(/au plus 128/);
  });

  it("une phrase de passe sans symbole est acceptée", () => {
    expect(checkPassword("le ciel est bleu aujourdhui", "awa").ok).toBe(true);
    expect(checkPassword("cheval agrafe pile batterie", "awa").ok).toBe(true);
    expect(checkPassword("Phrase-de-test-dev-2026", "awa").ok).toBe(true);
  });

  it("refuse le pseudonyme, seul ou contenu", () => {
    expect(refused("moussa_diallo", "Moussa_Diallo")).toMatch(/pseudonyme/);
    expect(refused("moussa_diallo-2026!", "Moussa_Diallo")).toMatch(
      /pseudonyme/,
    );
    // un pseudonyme très court n'interdit pas tout mot de passe qui contient ces lettres
    expect(checkPassword("a cheval bleu demain soir", "al").ok).toBe(true);
  });

  it.each([
    "password1234",
    "Password123456",
    "motdepasse2026",
    "azertyuiop123",
    "qwertyuiop1234",
    "123456789012",
    "iloveyou12345",
    "bismillah2026",
    "allahuakbar123",
    "muhammad12345",
    "mohamed2026!!",
    "senegal221221",
    "quran2026quran",
    "atelier-aqr-2026",
  ])("refuse le mot de passe courant ou lié au service : %s", (password) => {
    expect(refused(password)).toMatch(/courant|prévisible/);
  });

  it.each([
    "aaaaaaaaaaaa",
    "abababababab",
    "abcabcabcabc",
    "abcdefghijklm",
    "mnopqrstuvwxyz",
    "987654321098",
    "1234567890123",
    "!!!!!!!!!!!!",
  ])("refuse suites et répétitions : %s", (password) => {
    expect(refused(password)).toMatch(/prévisible/);
  });

  it("n'écarte pas à tort : une vraie phrase avec un mot courant dedans passe", () => {
    expect(checkPassword("mon password est long et unique", "awa").ok).toBe(
      true,
    );
  });

  it("normalise l'Unicode et la casse avant de comparer", () => {
    expect(refused("ＰＡＳＳＷＯＲＤ１２３４")).toMatch(/courant/);
  });
});
