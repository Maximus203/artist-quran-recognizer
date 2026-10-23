import { describe, expect, it } from "vitest";
import { AVATAR } from "./avatar-config";
import { checkPickedFile } from "./avatar-pick";

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
