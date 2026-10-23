import { describe, expect, it } from "vitest";
import { matchesEtag, weakEtag } from "./http-cache";

describe("weakEtag", () => {
  it("change avec la taille et la date de modification du fichier", () => {
    expect(weakEtag(100, 5)).toBe('W/"100-5"');
    expect(weakEtag(100, 5)).toBe(weakEtag(100, 5));
    expect(weakEtag(101, 5)).not.toBe(weakEtag(100, 5));
    expect(weakEtag(100, 6)).not.toBe(weakEtag(100, 5));
  });
  it("arrondit la date : des millisecondes fractionnaires ne font pas de faux changements", () => {
    expect(weakEtag(10, 1234.9)).toBe(weakEtag(10, 1234.1));
  });
});

describe("matchesEtag", () => {
  const tag = 'W/"100-5"';
  it("reconnaît l'étiquette envoyée par le navigateur, faible ou forte", () => {
    expect(matchesEtag(tag, tag)).toBe(true);
    expect(matchesEtag('"100-5"', tag)).toBe(true);
  });
  it("accepte une liste d'étiquettes et le joker", () => {
    expect(matchesEtag(`W/"1-1", ${tag}`, tag)).toBe(true);
    expect(matchesEtag("*", tag)).toBe(true);
  });
  it("refuse une autre étiquette, l'absence d'en-tête et une valeur vide", () => {
    expect(matchesEtag('W/"100-6"', tag)).toBe(false);
    expect(matchesEtag(null, tag)).toBe(false);
    expect(matchesEtag("", tag)).toBe(false);
  });
});
