import { describe, expect, it } from "vitest";
import { canModifyAnnotation, rejectedMessage } from "./review-access";

const me = { username: "Awa", admin: false };

describe("canModifyAnnotation", () => {
  it("le testeur modifie ses propres signalements", () => {
    expect(canModifyAnnotation({ tester: "Awa" }, me)).toBe(true);
  });
  it("jamais celui d'un autre testeur", () => {
    expect(canModifyAnnotation({ tester: "Moussa" }, me)).toBe(false);
  });
  it("un ancien signalement sans compte (« inconnu ») n'est modifiable que par un administrateur", () => {
    expect(canModifyAnnotation({ tester: "inconnu" }, me)).toBe(false);
    expect(
      canModifyAnnotation({ tester: "inconnu" }, { ...me, admin: true }),
    ).toBe(true);
  });
  it("un administrateur modifie tout", () => {
    expect(
      canModifyAnnotation({ tester: "Moussa" }, { ...me, admin: true }),
    ).toBe(true);
  });
  it("la comparaison est exacte, comme au serveur (pas de casse ignorée)", () => {
    expect(canModifyAnnotation({ tester: "awa" }, me)).toBe(false);
  });
});

describe("rejectedMessage", () => {
  it("rien à dire quand tout est accepté", () => {
    expect(rejectedMessage(0)).toBeNull();
  });
  it("explique le refus, au singulier et au pluriel", () => {
    expect(rejectedMessage(1)).toMatch(/1 signalement/);
    expect(rejectedMessage(3)).toMatch(/3 signalements/);
  });
});
