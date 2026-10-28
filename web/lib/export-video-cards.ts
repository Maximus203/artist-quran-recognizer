/**
 * Modèle des cartes-passages d'un export vidéo : pour chaque verset récité, ce qui s'affiche
 * pendant son intervalle (référence, arabe, traduction). Le dessin image par image vit dans
 * `export-video-frames.ts` ; le montage (mux) dans `export-video-args.ts`.
 *
 * INVARIANT I1 : l'arabe vient du résultat (corpus), jamais réécrit ici. I2 : la traduction
 * est rendue sans modification. L'attribution n'est PAS incrustée dans la vidéo (choix du
 * mainteneur, 2026-10-27) : le champ reste dans le modèle pour l'API, non dessiné.
 */
import type { Interval } from "./recognition";
import { surahName } from "./surahs";

export type VideoCardInput = {
  start: number;
  end: number;
  refLabel: string;
  arabic: string;
  translation: string | null;
  attribution: string | null;
};

export type VideoOverlay = { start: number; end: number; png: string };

const EMPTY = /^\s*$/;

/** Formate « An-Nisa 4:12 » (noms de `surahs.ts`, jamais du texte coranique). */
export function refLabelOf(ref: string): string {
  const [surah, ayah] = ref.split(":");
  const name = surahName(Number(surah));
  return name ? `${name} ${ref}` : ref;
}

/** Les cartes d'un export vidéo : les versets avec texte, temps et traduction du résultat. */
export function videoCardInputs(
  intervals: readonly Interval[],
): VideoCardInput[] {
  const cards: VideoCardInput[] = [];
  for (const item of intervals) {
    if (item.kind !== "verse" || !item.t || !item.ref) continue;
    if (!item.text || EMPTY.test(item.text)) continue;
    const translation = item.translation ?? undefined;
    const fragment =
      translation?.scope === "fragment" ? translation.fragment : undefined;
    const text =
      fragment && !EMPTY.test(fragment.text)
        ? fragment.text
        : translation?.text;
    cards.push({
      start: item.t[0],
      end: item.t[1],
      refLabel: refLabelOf(item.ref),
      arabic: item.text,
      translation: text && !EMPTY.test(text) ? text : null,
      attribution: translation?.attribution ?? null,
    });
  }
  return cards;
}
