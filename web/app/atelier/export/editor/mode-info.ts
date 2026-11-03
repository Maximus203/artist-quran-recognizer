import type { EditorMode } from "@/lib/export-editor-mode";

/**
 * Ce que l'on dit de chaque format d'éditeur, en UN seul endroit : la fenêtre de la première ouverture et la
 * section des paramètres montrent les mêmes mots. Du français clair, aucun mot technique ; pas une lettre
 * d'arabe (le Coran ne vient que du corpus, jamais d'un texte écrit à la main).
 */
export type ModeInfo = {
  id: EditorMode;
  /** Le nom du format. */
  name: string;
  /** La phrase de la personne qui le choisit. */
  quote: string;
  /** Ce que ça donne, en une phrase. */
  what: string;
  /** Pour qui, en une phrase. */
  who: string;
  /** Les trois temps de l'animation (légendes des trois images fixes, et texte alternatif). */
  frames: readonly [string, string, string];
  /** Le texte alternatif de l'animation : les trois temps, dits sans le mouvement. */
  alt: string;
};

const altOf = (frames: readonly string[]): string =>
  `Animation en boucle, en trois temps : 1, ${frames[0]}. 2, ${frames[1]}. 3, ${frames[2]}.`;

const make = (info: Omit<ModeInfo, "alt">): ModeInfo => ({
  ...info,
  alt: altOf(info.frames),
});

export const MODE_INFO: Record<EditorMode, ModeInfo> = {
  plateau: make({
    id: "plateau",
    name: "Plateau",
    quote: "« Je touche ce que je veux changer. »",
    what: "L’aperçu est l’éditeur : touche le texte, la traduction ou l’onde, et ses réglages s’ouvrent juste dessous.",
    who: "Pour toi si tu veux aller droit au but et régler à la main.",
    frames: [
      "Je touche le texte arabe",
      "Sa barre d’outils apparaît",
      "Je le déplace du doigt",
    ],
  }),
  table: make({
    id: "table",
    name: "Table de montage",
    quote: "« Je règle avec une chronologie, comme un monteur. »",
    what: "Un aperçu, une chronologie et des outils : tu fais glisser la tête de lecture et tu cales la vidéo de fond sur la récitation.",
    who: "Pour toi si tu as déjà monté une vidéo, ou si tu aimes voir le temps défiler.",
    frames: [
      "Aperçu, chronologie et outils",
      "Je fais glisser la tête de lecture",
      "Je cale la vidéo de fond",
    ],
  }),
  pas: make({
    id: "pas",
    name: "Pas à pas",
    quote: "« On me guide en trois étapes. »",
    what: "Le cadre, puis les textes, puis l’export : une chose à la fois, et un gros bouton à la fin.",
    who: "Pour toi si tu préfères être guidé, sans rien oublier.",
    frames: ["Le cadre", "Les textes", "Exporter"],
  }),
};

export const modeInfo = (mode: EditorMode): ModeInfo => MODE_INFO[mode];
