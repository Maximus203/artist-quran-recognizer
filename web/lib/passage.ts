/**
 * Ce que la carte « Passage actif » et la liste des intervalles affichent pour un intervalle du
 * moteur. Fonctions pures.
 *
 * INVARIANT I1 : le texte arabe d'un verset (et de la basmala) est celui du résultat, c'est-à-dire du
 * corpus : jamais écrit ici. Les formules (isti'adha, takbir, âmîn) viennent de `formulas.ts`, des
 * constantes que l'interface déclare hors Mushaf. INVARIANT I2 : la traduction QuranEnc est rendue
 * sans modification ; `splitNoteMarkers` ne fait que la découper pour styler les `[n]` à l'affichage.
 */
import { FORMULAS, formulaFromLabel, type Formula } from "./formulas";
import type { Interval } from "./recognition";

export type TranslationView = {
  text: string;
  attribution: string;
  translationId: string;
  version: string;
  /** Verset partiel : la traduction est celle du verset entier. */
  partialNote: boolean;
};

export type PassageModel =
  | { type: "empty" }
  | {
      type: "verse";
      ref: string;
      range: [number, number] | null;
      arabic: string;
      /** Numéro de verset en chiffres arabes pour le médaillon (décor, jamais dans le texte). */
      ayahNumber: string | null;
      translation: TranslationView | null;
      badges: string[];
    }
  | {
      type: "basmala";
      ref: string | null;
      range: [number, number] | null;
      arabic: string | null;
      translation: TranslationView | null;
    }
  | { type: "verse_no_text"; ref: string; range: [number, number] | null }
  | { type: "hypothesis"; ref: string | null; range: [number, number] | null }
  | {
      type: "uncertain";
      candidates: string[];
      range: [number, number] | null;
    }
  | { type: "formula"; formula: Formula; range: [number, number] }
  | { type: "other_speech"; label: string; range: [number, number] }
  | { type: "abstention"; reason: string; range: [number, number] };

export type IntervalStyle =
  | "recognized"
  | "inferred"
  | "uncertain"
  | "formula"
  | "abstention";

const ABSTENTION_REASONS: Record<string, string> = {
  silence: "Silence selon le moteur",
  empty_transcript: "Aucun texte exploitable",
  no_candidate: "Aucune correspondance",
  below_threshold: "Score insuffisant",
};

const INDIC = "٠١٢٣٤٥٦٧٨٩";
export const toArabicIndic = (value: number | string): string =>
  String(value).replace(/\d/g, (digit) => INDIC[Number(digit)]);

/** Segments d'une traduction, `[n]` isolés pour l'exposant ; la concaténation redonne la chaîne. */
export function splitNoteMarkers(
  text: string,
): { text: string; note: boolean }[] {
  const parts: { text: string; note: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(/\[\d+\]/g)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ text: text.slice(last, at), note: false });
    parts.push({ text: match[0], note: true });
    last = at + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), note: false });
  return parts.length ? parts : [{ text, note: false }];
}

type Loose = {
  kind: string;
  t?: [number, number] | null;
  text?: string | null;
  translation?: {
    text: string;
    attribution: string;
    translation_id: string;
    version: string;
  } | null;
  basmala?: boolean;
  label?: string;
};
const loose = (item: Interval): Loose => item as unknown as Loose;

/** Basmala : un verset marqué `basmala`, ou une étiquette `[basmala]` (anciens résultats). */
export function isBasmala(item: Interval): boolean {
  const value = loose(item);
  if (value.basmala === true) return true;
  return (
    value.kind === "non_quran" &&
    (value.label ?? "").replace(/[^a-z]/gi, "").toLowerCase() === "basmala"
  );
}

function translationView(
  item: Interval,
  partial: boolean,
): TranslationView | null {
  const t = loose(item).translation;
  return t
    ? {
        text: t.text,
        attribution: t.attribution,
        translationId: t.translation_id,
        version: t.version,
        partialNote: partial,
      }
    : null;
}

export function describePassage(item: Interval | null): PassageModel {
  if (!item) return { type: "empty" };
  const range = item.t ?? null;
  if (isBasmala(item))
    return {
      type: "basmala",
      ref: item.kind === "verse" ? item.ref : null,
      range,
      arabic: loose(item).text || null,
      translation: translationView(item, false),
    };
  if (item.kind === "verse") {
    if (item.status === "uncertain")
      return { type: "uncertain", candidates: item.candidates, range };
    if (item.status === "inferred")
      return { type: "hypothesis", ref: item.ref, range };
    if (!item.text || !item.ref)
      return { type: "verse_no_text", ref: item.ref ?? "", range };
    const badges = ["Reconnu"];
    if (item.partial) badges.push("Passage partiel");
    if (item.repetition) badges.push("Répétition");
    if (item.time_interpolated) badges.push("Temps interpolé");
    return {
      type: "verse",
      ref: item.ref,
      range,
      arabic: item.text,
      ayahNumber: item.partial
        ? null
        : toArabicIndic(item.ref.split(":")[1] ?? ""),
      translation: translationView(item, item.partial),
      badges,
    };
  }
  if (item.kind === "non_quran") {
    const formula = formulaFromLabel(item.label);
    return formula
      ? { type: "formula", formula, range: item.t }
      : { type: "other_speech", label: item.label, range: item.t };
  }
  return {
    type: "abstention",
    reason: ABSTENTION_REASONS[item.reason] ?? item.reason,
    range: item.t,
  };
}

export function intervalLabel(item: Interval): string {
  if (isBasmala(item)) return "Basmala";
  if (item.kind === "verse")
    return item.status === "uncertain"
      ? `Références possibles : ${item.candidates.join(" · ") || "aucune"}`
      : item.ref || "Verset";
  if (item.kind === "non_quran")
    return formulaFromLabel(item.label)?.name ?? item.label;
  return ABSTENTION_REASONS[item.reason] ?? item.reason;
}

export function intervalStyle(item: Interval): IntervalStyle {
  if (item.kind === "verse") return item.status;
  return item.kind === "non_quran" ? "formula" : "abstention";
}

const STATE_LABELS: Record<IntervalStyle, string> = {
  recognized: "Reconnu",
  inferred: "Déduit · non entendu",
  uncertain: "Incertain",
  formula: "Formule",
  abstention: "Abstention",
};
export const intervalStateLabel = (item: Interval): string =>
  STATE_LABELS[intervalStyle(item)];
export const STYLE_LABELS = STATE_LABELS;

/** Indice de l'intervalle qui couvre l'instant (formules et abstentions comprises), -1 sinon. */
export function activeIndex(
  intervals: readonly Interval[],
  time: number,
): number {
  return intervals.findIndex(
    (item) => item.t !== null && item.t[0] <= time && time < item.t[1],
  );
}

/**
 * Intervalle montré par la carte : celui qu'on a choisi tant que la lecture est dedans (ou qu'il n'a
 * pas de temps), sinon celui qui couvre l'instant, sinon -1.
 */
export function shownIndex(
  intervals: readonly Interval[],
  selected: number | null,
  time: number,
): number {
  const chosen = selected !== null ? intervals[selected] : undefined;
  if (
    chosen &&
    (chosen.t === null || (chosen.t[0] <= time && time < chosen.t[1]))
  )
    return selected as number;
  return activeIndex(intervals, time);
}

/** Filtres de la liste des intervalles ; l'indice d'origine est conservé (clic, sélection). */
export function filterIntervals(
  intervals: readonly Interval[],
  filter: string,
): { item: Interval; index: number }[] {
  return intervals
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      filter === "all"
        ? true
        : filter === "verse"
          ? item.kind === "verse"
          : filter === "uncertain"
            ? item.kind === "verse" && item.status !== "recognized"
            : item.kind === filter,
    );
}

export const FORMULA_LIST = Object.values(FORMULAS);
