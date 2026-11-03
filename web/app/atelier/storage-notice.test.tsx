import { describe, expect, it } from "vitest";
import { storageMessage } from "./storage-notice";

const GIO = 1024 ** 3;

describe("message d'espace presque plein ou plein", () => {
  it("à 80 % : prévient et dit ce qu'il faut supprimer, sans bloquer", () => {
    const text = storageMessage(
      { used_bytes: 4.2 * GIO, limit_bytes: 5 * GIO },
      false,
    );
    expect(text).toMatch(/presque plein/);
    expect(text).not.toMatch(/bloqués/);
  });

  it("plein : dit que les imports sont bloqués", () => {
    const text = storageMessage(
      { used_bytes: 5 * GIO, limit_bytes: 5 * GIO },
      true,
    );
    expect(text).toMatch(/plein/);
    expect(text).toMatch(/imports sont bloqués/);
  });
});
