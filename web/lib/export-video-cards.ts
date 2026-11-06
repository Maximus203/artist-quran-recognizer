/**
 * Modèle des cartes-passages d'un export vidéo : pour chaque verset récité, ce qui s'affiche
 * pendant son intervalle (référence, arabe, traduction). Le dessin image par image vit dans
 * `export-video-frames.ts` ; le montage (mux) dans `export-video-args.ts`.
 *
 * INVARIANT I1 : l'arabe vient du résultat (corpus), jamais réécrit ici. I2 : la traduction
 * est rendue sans modification. L'attribution n'est PAS incrustée dans la vidéo (choix du
 * mainteneur, 2026-10-27) : le champ reste dans le modèle pour l'API, non dessiné.
 */
import {
  DEFAULT_SPLIT,
  splitVerse,
  type SplitOptions,
} from "./export-video-split";
import { formulaFromLabel } from "./formulas";
import { isFreeSpeechCandidate, type TranslatedItem } from "./free-speech";
import type { Interval } from "./recognition";
import { surahName } from "./surahs";

export type VideoCardInput = {
  start: number;
  end: number;
  refLabel: string;
  arabic: string;
  translation: string | null;
  attribution: string | null;
  /** Rang et nombre de cartes du verset quand il est affiché en plusieurs temps (pause du récitant, durée). */
  part?: [number, number];
  /** Vrai si la traduction de cette carte a été coupée au prorata des mots, pas par QuranEnc. */
  approximate?: boolean;
  /** Vrai pour une formule récitée hors Mushaf (isti'adha, takbir, âmîn) : arabe et traduction constants, pas QuranEnc. */
  formula?: true;
  /** Vrai pour une parole libre : arabe transcrit et traduction produits par des modèles, hors Coran. */
  automatic?: true;
};

export type VideoOverlay = { start: number; end: number; png: string };

const EMPTY = /^\s*$/;

/** Formate « An-Nisa 4:12 » (noms de `surahs.ts`, jamais du texte coranique). */
export function refLabelOf(ref: string): string {
  const [surah, ayah] = ref.split(":");
  const name = surahName(Number(surah));
  return name ? `${name} ${ref}` : ref;
}

/** Une carte et d'où elle vient : le verset, et les mots de ce verset qu'elle affiche (`null` : tous). */
export type CardSource = {
  card: VideoCardInput;
  interval: Interval;
  range: [number, number] | null;
};

/**
 * La carte d'une zone non coranique que l'on connaît (I4 : toute autre parole reste sans carte).
 * - basmala : verset 1:1, texte du corpus et traduction QuranEnc telles que le résultat les porte
 *   (I1, I2) ; sans texte (copie expurgée), pas de carte ;
 * - isti'adha, takbir, âmîn : arabe et traduction constants de `formulas.ts`, jamais présentés
 *   comme le Mushaf ni comme QuranEnc (`formula: true`, aucune attribution).
 */
function formulaSource(item: Interval): CardSource | null {
  if (item.kind !== "non_quran" || !item.t) return null;
  const [start, end] = item.t;
  if (item.basmala === true) {
    if (!item.text || EMPTY.test(item.text)) return null;
    const translation = item.translation?.text;
    return {
      interval: item,
      range: null,
      card: {
        start,
        end,
        refLabel: "Basmala",
        arabic: item.text,
        translation:
          translation && !EMPTY.test(translation) ? translation : null,
        attribution: item.translation?.attribution ?? null,
      },
    };
  }
  const formula = formulaFromLabel(item.label);
  if (!formula) return null;
  return {
    interval: item,
    range: null,
    card: {
      start,
      end,
      refLabel: formula.name,
      arabic: formula.arabic,
      translation: formula.translation,
      attribution: null,
      formula: true,
    },
  };
}

/** Libellé de la carte d'une parole libre : jamais une référence du Coran (I1, I4). */
export const FREE_SPEECH_CARD_LABEL =
  "Parole hors Coran · traduction automatique";

/** La carte d'une parole libre déjà filtrée par `shownFreeSpeech` ; temps de l'intervalle du résultat. */
function freeSpeechSource(item: Interval, spoken: TranslatedItem): CardSource {
  const [start, end] = item.t as [number, number];
  return {
    interval: item,
    range: null,
    card: {
      start,
      end,
      refLabel: FREE_SPEECH_CARD_LABEL,
      arabic: spoken.transcript_ar,
      translation: spoken.translation_fr,
      attribution: null,
      automatic: true,
    },
  };
}

/**
 * Les cartes d'un export vidéo, chacune avec son verset d'origine : les versets avec texte, temps et
 * traduction du résultat. Un verset est affiché en plusieurs temps quand le récitant s'arrête ou
 * quand il dépasse la durée maximale (`splitVerse`) : le texte ne dépasse jamais ce qui vient d'être dit.
 */
export function videoCardSources(
  intervals: readonly Interval[],
  split: SplitOptions = DEFAULT_SPLIT,
  freeSpeech: ReadonlyMap<number, TranslatedItem> | null = null,
): CardSource[] {
  const out: CardSource[] = [];
  for (const [rank, item] of intervals.entries()) {
    const spoken = freeSpeech?.get(rank);
    if (spoken && isFreeSpeechCandidate(item)) {
      out.push(freeSpeechSource(item, spoken));
      continue;
    }
    const formula = formulaSource(item);
    if (formula) {
      out.push(formula);
      continue;
    }
    if (item.kind !== "verse" || !item.t || !item.ref) continue;
    if (!item.text || EMPTY.test(item.text)) continue;
    const attribution = item.translation?.attribution ?? null;
    const refLabel = refLabelOf(item.ref);
    for (const piece of splitVerse(item, split))
      out.push({
        interval: item,
        range: piece.range ?? null,
        card: {
          start: piece.start,
          end: piece.end,
          refLabel,
          arabic: piece.arabic,
          translation: piece.translation,
          attribution,
          ...(piece.part ? { part: piece.part } : {}),
          ...(piece.approximate ? { approximate: true } : {}),
        },
      });
  }
  return out;
}

export function videoCardInputs(
  intervals: readonly Interval[],
  split: SplitOptions = DEFAULT_SPLIT,
  freeSpeech: ReadonlyMap<number, TranslatedItem> | null = null,
): VideoCardInput[] {
  return videoCardSources(intervals, split, freeSpeech).map(
    (source) => source.card,
  );
}
