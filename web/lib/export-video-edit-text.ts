/**
 * Les mots de l'éditeur de la vidéo d'export : noms des éléments, phrases annoncées aux lecteurs d'écran
 * (`aria-live`) après chaque geste, compte rendu de l'ajustement du texte à sa zone. Fonctions PURES,
 * partagées par les trois éditeurs et la vue bureau : un geste est annoncé partout de la même façon.
 *
 * Aucun texte coranique ici (I1) : ce ne sont que des noms d'éléments et des pourcentages.
 */
import { sizePercent } from "./export-video-edit";
import type { CardLayout, BlockFit } from "./export-video-layout";
import type { BlockId, Box, TextBlockId } from "./export-video-model";

/** Nom complet, dans les listes, les titres et les annonces. */
export const BLOCK_LABEL: Record<BlockId, string> = {
  arabic: "Texte arabe",
  translation: "Traduction",
  wave: "Onde sonore",
  ref: "Sourate et verset",
};

/** Nom court : pastilles de choix, étiquette sur l'aperçu. */
export const BLOCK_SHORT: Record<BlockId, string> = {
  arabic: "Arabe",
  translation: "Traduction",
  wave: "Onde",
  ref: "Verset",
};

/** Une phrase pour dire quel est le rôle de l'élément (sous le titre de ses réglages). */
export const BLOCK_ROLE: Record<BlockId, string> = {
  arabic: "Texte du Mushaf, jamais modifiable",
  translation: "QuranEnc, restituée telle quelle",
  wave: "Suit le son de la récitation",
  ref: "Repère de la sourate et du verset",
};

const pct = (fraction: number): number => Math.round(fraction * 100);

/** Après un déplacement ou un changement de zone : où est le centre, et la taille de la zone. */
export function describePlacement(id: BlockId, box: Box): string {
  return `${BLOCK_LABEL[id]} : centre à ${pct(box.x + box.w / 2)} % sur ${pct(box.y + box.h / 2)} %, zone de ${pct(box.w)} % sur ${pct(box.h)} %.`;
}

/** Après un changement de taille du texte. */
export function describeSize(id: BlockId, size: number): string {
  return `${BLOCK_LABEL[id]} : taille ${sizePercent(size)} %.`;
}

/** Après avoir masqué ou affiché un élément. */
export function describeVisibility(id: BlockId, shown: boolean): string {
  // Accord : l'onde et la traduction sont féminines, « sourate et verset » est pluriel.
  const agreement = id === "ref" ? "s" : id === "arabic" ? "" : "e";
  return `${BLOCK_LABEL[id]} ${shown ? "affiché" : "masqué"}${agreement}.`;
}

/** L'onde n'a pas de texte : ni taille en pourcents, ni pincement. */
export const sizeLockedBlock = (id: BlockId): boolean => id === "wave";

export type FitEntry = Pick<BlockFit, "note" | "overflow">;
export type FitReport = Partial<Record<TextBlockId, FitEntry>>;

/**
 * Ce que l'ajustement de chaque texte à sa zone a fait (« réduit à 87 % », « trop petite ») : lu sur la
 * mise en page de la carte montrée dans l'aperçu. Un texte absent de la carte n'a pas d'entrée.
 */
export function fitReport(card: CardLayout | null): FitReport {
  if (!card) return {};
  const report: FitReport = {};
  for (const id of ["ref", "arabic", "translation"] as const) {
    const block = card[id];
    if (block) report[id] = { note: block.note, overflow: block.overflow };
  }
  return report;
}
