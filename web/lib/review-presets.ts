/**
 * Présélections de la revue humaine : LA source unique des libellés (aucun texte épars dans
 * l'interface). Les `id` sont stables (ils sont stockés dans les exports) ; les libellés peuvent
 * changer sans migration. `legacy` relie chaque puce au `type` historique d'`aqr.review/1`, pour
 * que les exports existants gardent leur champ.
 */

export type LegacyType =
  | "wrong_verse"
  | "missing_verse"
  | "repetition"
  | "timing"
  | "other";

type Item = { id: string; label: string; legacy: LegacyType };

export type PresetFamily = {
  id: string;
  label: string;
  hint: string;
  /** Ouverte d'office dans le panneau (les autres le sont seulement si une puce y est choisie). */
  defaultOpen: boolean;
  items: readonly Item[];
};

export const REVIEW_PRESETS: readonly PresetFamily[] = [
  {
    id: "verse",
    label: "Verset",
    hint: "Ce que le moteur affiche est faux ou incomplet.",
    defaultOpen: true,
    items: [
      { id: "wrong_verse", label: "Verset faux", legacy: "wrong_verse" },
      {
        id: "missing_verse",
        label: "Verset manquant",
        legacy: "missing_verse",
      },
      { id: "extra_verse", label: "Verset en trop", legacy: "other" },
      {
        id: "repetition_missed",
        label: "Répétition non détectée",
        legacy: "repetition",
      },
    ],
  },
  {
    id: "bounds",
    label: "Limites et synchronisation",
    hint: "Le verset est bon, mais pas ses bornes.",
    defaultOpen: true,
    items: [
      { id: "start_early", label: "Début trop tôt", legacy: "timing" },
      { id: "start_late", label: "Début trop tard", legacy: "timing" },
      { id: "end_early", label: "Fin trop tôt", legacy: "timing" },
      { id: "end_late", label: "Fin trop tard", legacy: "timing" },
      {
        id: "display_offset",
        label: "Affichage décalé de la voix",
        legacy: "timing",
      },
    ],
  },
  {
    id: "detection",
    label: "Coran ou pas Coran",
    hint: "Le moteur se trompe sur la nature de la parole.",
    defaultOpen: false,
    items: [
      {
        id: "non_quran_as_quran",
        label: "Parole non coranique prise pour du Coran",
        legacy: "other",
      },
      { id: "quran_undetected", label: "Coran non détecté", legacy: "other" },
      {
        id: "abstention_wrong",
        label: "Abstention à tort (le verset était audible)",
        legacy: "other",
      },
    ],
  },
  {
    id: "formula",
    label: "Formules",
    hint: "Basmala, isti’adha, takbir, âmîn.",
    defaultOpen: false,
    items: [
      { id: "basmala_missing", label: "Basmala manquante", legacy: "other" },
      { id: "basmala_extra", label: "Basmala en trop", legacy: "other" },
      { id: "istiadha_missing", label: "Isti’adha manquante", legacy: "other" },
      { id: "istiadha_extra", label: "Isti’adha en trop", legacy: "other" },
      {
        id: "takbir_amin",
        label: "Takbir ou âmîn manquant / en trop",
        legacy: "other",
      },
    ],
  },
  {
    id: "recitation",
    label: "Récitation",
    hint: "Ce qui tient au lecteur plutôt qu’au moteur.",
    defaultOpen: false,
    items: [
      {
        id: "riwaya",
        label: "Mauvaise récitation / lecture (riwaya)",
        legacy: "other",
      },
      {
        id: "reciter_error",
        label: "Le lecteur se trompe (le moteur a raison)",
        legacy: "other",
      },
    ],
  },
  {
    id: "audio",
    label: "Qualité de l’audio",
    hint: "",
    defaultOpen: false,
    items: [
      { id: "inaudible", label: "Audio inaudible", legacy: "other" },
      { id: "noise", label: "Bruit ou parasites", legacy: "other" },
      { id: "overlap", label: "Plusieurs voix en même temps", legacy: "other" },
    ],
  },
  {
    id: "other",
    label: "Autre",
    hint: "",
    defaultOpen: false,
    items: [
      { id: "other", label: "Autre (précise en commentaire)", legacy: "other" },
    ],
  },
];

const ALL_ITEMS: readonly Item[] = REVIEW_PRESETS.flatMap((f) => f.items);
const BY_ID = new Map(ALL_ITEMS.map((item) => [item.id, item]));

export const allPresetIds = (): string[] => ALL_ITEMS.map((item) => item.id);

/** Libellé d'une puce ; un identifiant inconnu (liste modifiée depuis) s'affiche tel quel. */
export function presetLabel(id: string): string {
  return BY_ID.get(id)?.label ?? id;
}

/** Type historique d'`aqr.review/1` d'après le premier tag (« other » à défaut). */
export function legacyTypeOf(tags: readonly string[]): LegacyType {
  const first = tags[0];
  return (first && BY_ID.get(first)?.legacy) || "other";
}
