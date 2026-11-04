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
 * Les cartes d'un export vidéo, chacune avec son verset d'origine : les versets avec texte, temps et
 * traduction du résultat. Un verset est affiché en plusieurs temps quand le récitant s'arrête ou
 * quand il dépasse la durée maximale (`splitVerse`) : le texte ne dépasse jamais ce qui vient d'être dit.
 */
export function videoCardSources(
  intervals: readonly Interval[],
  split: SplitOptions = DEFAULT_SPLIT,
): CardSource[] {
  const out: CardSource[] = [];
  for (const item of intervals) {
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
): VideoCardInput[] {
  return videoCardSources(intervals, split).map((source) => source.card);
}
