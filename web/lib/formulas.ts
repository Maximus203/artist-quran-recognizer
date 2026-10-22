/**
 * Formules récitées hors Mushaf : isti'adha, takbir, âmîn.
 *
 * INVARIANT I1 : ce ne sont PAS des versets. Leur texte arabe et leur traduction française sont des
 * CONSTANTES de l'interface, écrites ici et nulle part ailleurs ; elles ne viennent ni du corpus
 * Tanzil ni de QuranEnc, et l'interface le dit (`FORMULA_NOTICE`). Les traductions sont indicatives :
 * décision à valider par le mainteneur (`.artist/decision-log.md`).
 *
 * La basmala n'est PAS ici : elle vient du corpus (verset 1:1) et s'affiche comme un verset.
 */

export type FormulaId = "istiadha" | "takbir" | "amin";

export type Formula = {
  id: FormulaId;
  /** Libellé court en arabe, affiché dans l'étiquette de formule. */
  label: string;
  /** Nom français, en translittération. */
  name: string;
  arabic: string;
  translation: string;
};

export const FORMULA_NOTICE =
  "Formule — hors Mushaf, traduction indicative (non QuranEnc)";

export const FORMULAS: Readonly<Record<FormulaId, Formula>> = {
  istiadha: {
    id: "istiadha",
    label: "الاستعاذة",
    name: "Isti’adha",
    arabic: "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ",
    translation: "Je cherche refuge auprès d’Allah contre Satan le banni.",
  },
  takbir: {
    id: "takbir",
    label: "التكبير",
    name: "Takbir",
    arabic: "اللَّهُ أَكْبَرُ",
    translation: "Allah est le plus grand.",
  },
  amin: {
    id: "amin",
    label: "آمين",
    name: "Âmîn",
    arabic: "آمِينَ",
    translation: "Exauce-nous.",
  },
};

/** Simplifie une étiquette du moteur (`[isti'adha]`, `âmîn`…) : minuscules, sans accent ni ponctuation. */
function simplify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

/** La formule désignée par une étiquette `non_quran` du moteur, ou null (basmala et reste exclus). */
export function formulaFromLabel(label: string): Formula | null {
  const key = simplify(label);
  if (key === "istiadha") return FORMULAS.istiadha;
  if (key === "takbir") return FORMULAS.takbir;
  if (key === "amin") return FORMULAS.amin;
  return null;
}
