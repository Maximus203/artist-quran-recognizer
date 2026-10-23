import { describe, expect, it } from "vitest";
import { AVATAR } from "./avatar-config";
import { checkPickedDimensions, checkPickedFile } from "./avatar-pick";

describe("checkPickedDimensions : mêmes bornes que le serveur, avant l'aperçu", () => {
  it("accepte des dimensions dans les bornes", () => {
    expect(checkPickedDimensions(800, 400)).toBeNull();
    expect(checkPickedDimensions(AVATAR.minSide, AVATAR.minSide)).toBeNull();
    expect(checkPickedDimensions(AVATAR.maxSide, 100)).toBeNull();
  });

  it("refuse trop petit, trop grand, ou trop de pixels", () => {
    for (const [w, h] of [
      [1, 1],
      [31, 400],
      [400, 31],
      [9000, 100],
      [100, 9000],
      [8000, 8000],
    ])
      expect(checkPickedDimensions(w, h)).toMatch(/Dimensions refusées/);
  });

  it("refuse des dimensions absurdes (0, NaN)", () => {
    expect(checkPickedDimensions(0, 0)).not.toBeNull();
    expect(checkPickedDimensions(Number.NaN, 100)).not.toBeNull();
  });
});

describe("checkPickedFile : contrôle de confort avant l'envoi (le serveur reste juge)", () => {
  it("accepte JPEG, PNG et WebP sous la limite", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"])
      expect(checkPickedFile({ type, size: 1000 })).toBeNull();
  });

  it("refuse un fichier vide", () => {
    expect(checkPickedFile({ type: "image/png", size: 0 })).toMatch(
      /vide|image/i,
    );
  });

  it("refuse un fichier trop lourd en disant la limite", () => {
    expect(
      checkPickedFile({ type: "image/png", size: AVATAR.maxBytes + 1 }),
    ).toMatch(/2 Mo/);
  });

  it("refuse SVG, GIF et tout autre type annoncé", () => {
    for (const type of [
      "image/svg+xml",
      "image/gif",
      "text/html",
      "application/pdf",
    ])
      expect(checkPickedFile({ type, size: 1000 })).toMatch(
        /JPEG, PNG ou WebP/,
      );
  });

  it("laisse passer un type inconnu du navigateur (le serveur lira le contenu)", () => {
    expect(checkPickedFile({ type: "", size: 1000 })).toBeNull();
  });
});
