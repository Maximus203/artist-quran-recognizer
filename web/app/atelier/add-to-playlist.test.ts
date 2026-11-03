import { describe, expect, it } from "vitest";
import { addedMessage } from "./add-to-playlist";

describe("confirmation d'ajout à une playlist", () => {
  it("dit combien d'audios sont entrés", () => {
    expect(addedMessage("Yusuf", { added: 1, skipped: 0 })).toBe(
      "1 audio ajouté à « Yusuf »",
    );
    expect(addedMessage("Yusuf", { added: 3, skipped: 0 })).toBe(
      "3 audios ajoutés à « Yusuf »",
    );
  });

  it("signale ceux qui n'ont pas pu entrer (déjà là ou invisibles)", () => {
    expect(addedMessage("Yusuf", { added: 2, skipped: 1 })).toBe(
      "2 audios ajoutés à « Yusuf » · 1 déjà présent ou indisponible",
    );
    expect(addedMessage("Yusuf", { added: 0, skipped: 2 })).toContain(
      "0 audio ajouté",
    );
  });

  it("une playlist créée sans audio : zéro ajouté", () => {
    expect(addedMessage("Vide", null)).toBe("0 audio ajouté à « Vide »");
  });
});
