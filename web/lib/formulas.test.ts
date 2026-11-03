import { describe, expect, it } from "vitest";
import { FORMULAS, FORMULA_NOTICE, formulaFromLabel } from "./formulas";

describe("FORMULAS (constantes hors Mushaf)", () => {
  it("porte les textes validés pour isti'adha, takbir et âmîn", () => {
    expect(FORMULAS.istiadha.arabic).toBe(
      "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ",
    );
    expect(FORMULAS.istiadha.translation).toBe(
      "Je cherche refuge auprès d’Allah contre Satan le banni.",
    );
    expect(FORMULAS.takbir.arabic).toBe("اللَّهُ أَكْبَرُ");
    expect(FORMULAS.takbir.translation).toBe("Allah est le plus grand.");
    expect(FORMULAS.amin.arabic).toBe("آمِينَ");
    expect(FORMULAS.amin.translation).toBe("Exauce-nous.");
  });
  it("rappelle que ce n'est ni le Mushaf ni QuranEnc", () => {
    expect(FORMULA_NOTICE).toBe(
      "Formule — hors Mushaf, traduction indicative (non QuranEnc)",
    );
  });
  it("donne un libellé arabe court à chaque formule", () => {
    expect(FORMULAS.istiadha.label).toBe("الاستعاذة");
    expect(FORMULAS.takbir.label).toBe("التكبير");
    expect(FORMULAS.amin.label).toBe("آمين");
  });
});

describe("formulaFromLabel", () => {
  it("reconnaît les étiquettes émises par le moteur", () => {
    expect(formulaFromLabel("[isti'adha]")?.id).toBe("istiadha");
    expect(formulaFromLabel("[takbir]")?.id).toBe("takbir");
    expect(formulaFromLabel("[amin]")?.id).toBe("amin");
  });
  it("tolère les variantes d'écriture", () => {
    expect(formulaFromLabel("istiadha")?.id).toBe("istiadha");
    expect(formulaFromLabel("Isti’adha")?.id).toBe("istiadha");
    expect(formulaFromLabel("âmîn")?.id).toBe("amin");
    expect(formulaFromLabel(" TAKBIR ")?.id).toBe("takbir");
  });
  it("laisse la basmala hors de la table (elle vient du corpus)", () => {
    expect(formulaFromLabel("[basmala]")).toBeNull();
  });
  it("ne reconnaît pas une parole quelconque", () => {
    expect(formulaFromLabel("[french]")).toBeNull();
    expect(formulaFromLabel("")).toBeNull();
  });
});
