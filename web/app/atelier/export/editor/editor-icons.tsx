/**
 * Icônes de l'éditeur de la vidéo d'export, en plus de celles de l'export (`../export-icons.tsx`) :
 * dessinées pour le projet, tracé de 1,6 px à bouts ronds comme le reste (le style `svg.i` vient de
 * `base.css`). Aucun paquet d'icônes tiers. Les icônes déjà dans `XIcon` (plus, moins, cadenas, retour…)
 * ne sont pas redessinées ici.
 */
const PATHS = {
  /** Texte arabe : un grand et un petit « A ». */
  text: (
    <>
      <path d="M3.5 18.5L9 5l5.5 13.5M5.4 14h7.2" />
      <path d="M15.5 18.5l3-7.2 3 7.2M16.5 16.2h4" />
    </>
  ),
  /** Traduction : guillemets. */
  quote: (
    <>
      <path d="M5 17.5v-3.2c0-3 1.5-5 4-5.8M5 14.3h4v3.2H5z" />
      <path d="M14 17.5v-3.2c0-3 1.5-5 4-5.8M14 14.3h4v3.2h-4z" />
    </>
  ),
  /** Onde sonore : des barres de hauteurs différentes. */
  wave: <path d="M3.5 12h1M7 8.5v7M10.5 5.5v13M14 9v6M17.5 7v10M20.5 12h0" />,
  /** Sourate et verset : le signe numéro. */
  hash: <path d="M9 4.5L7.5 19.5M16.5 4.5L15 19.5M4.5 9h15M4 15h15" />,
  /** Cadre, fond, passages : des calques empilés. */
  layers: (
    <>
      <path d="M12 4.5l8 4.2-8 4.2-8-4.2z" />
      <path d="M4 12.6l8 4.2 8-4.2M4 16.6l8 4 8-4" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6 6.5 12 6.5 21.2 12 21.2 12 18 17.5 12 17.5 2.8 12 2.8 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  "eye-off": (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 6.7A9.7 9.7 0 0 1 12 6.5c6 0 9.2 5.5 9.2 5.5a15.4 15.4 0 0 1-2.9 3.5M6.5 8.4A15.2 15.2 0 0 0 2.8 12S6 17.5 12 17.5a9.5 9.5 0 0 0 3.2-.6" />
      <path d="M10 10.2a2.6 2.6 0 0 0 3.7 3.5" />
    </>
  ),
  /** Fond derrière le texte : une goutte. */
  drop: (
    <path d="M12 3.5s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.700 12 3.500 12 3.500z" />
  ),
  /** Position : la croix de déplacement. */
  move: (
    <path d="M12 3.5v17M3.5 12h17M12 3.5L9.2 6.3M12 3.5l2.8 2.8M12 20.5l-2.8-2.8M12 20.5l2.8-2.8M3.5 12l2.8-2.8M3.5 12l2.8 2.8M20.5 12l-2.8-2.8M20.5 12l-2.8 2.8" />
  ),
  /** Réglages : des curseurs. */
  sliders: (
    <>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </>
  ),
  /** L'aide du premier affichage : une main qui touche. */
  hand: (
    <path d="M9 12.2V5.8a1.5 1.5 0 0 1 3 0v4.4m0-.9a1.5 1.5 0 0 1 3 0v1.1m0-.6a1.5 1.5 0 0 1 3 0v4.2c0 3.2-2.200 5.300-5.200 5.300h-.8c-2 0-3.300-1-4.300-2.600l-2.900-4.600a1.400 1.400 0 0 1 2.300-1.600L9 13.800" />
  ),
  palette: (
    <>
      <path d="M12 3.5a8.500 8.500 0 1 0 0 17c1.300 0 1.900-.9 1.500-1.900-.4-1 .1-2.100 1.200-2.100h2.100a3.200 3.200 0 0 0 3.200-3.200C20 7.600 16.400 3.500 12 3.500z" />
      <circle cx="8.200" cy="11.500" r=".9" />
      <circle cx="11" cy="7.800" r=".9" />
      <circle cx="15.200" cy="8.800" r=".9" />
    </>
  ),
  /** Format : un cadre avec ses coins. */
  format: (
    <path d="M4.5 9V5.5a1 1 0 0 1 1-1H9M15 4.5h3.500a1 1 0 0 1 1 1V9M19.500 15v3.500a1 1 0 0 1-1 1H15M9 19.500H5.500a1 1 0 0 1-1-1V15M9 9.500h6v5H9z" />
  ),
  /** Fond : une image (soleil et colline). */
  image: (
    <>
      <rect x="3.500" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.500" />
      <path d="M4 17.500l5-4.500 3.500 3 3-2.500 4.500 4" />
    </>
  ),
  /** Passages : une liste. */
  list: (
    <path d="M8.500 7h11M8.500 12h11M8.500 17h11M4.500 7h.01M4.500 12h.01M4.500 17h.01" />
  ),
  "arrow-up": <path d="M12 19V5.500M6.500 11L12 5.500l5.500 5.500" />,
  "arrow-down": <path d="M12 5v13.500M6.500 13L12 18.500l5.500-5.500" />,
  "arrow-left": <path d="M19 12H5.500M11 6.500L5.500 12l5.500 5.500" />,
  "arrow-right": <path d="M5 12h13.500M13 6.500l5.500 5.500-5.500 5.500" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  /** Bord de l'image : l'aimant vers le centre. */
  center: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.500v3.500M12 17v3.500M3.500 12H7M17 12h3.500" />
    </>
  ),
} as const;

export type EditorIconName = keyof typeof PATHS;

/** L'icône de chaque élément de la vidéo (liste, pastilles, étiquette sur l'aperçu). */
export const BLOCK_ICON: Record<
  "arabic" | "translation" | "wave" | "ref",
  EditorIconName
> = {
  arabic: "text",
  translation: "quote",
  wave: "wave",
  ref: "hash",
};

export function EIcon({
  name,
  size,
  className,
}: {
  name: EditorIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`i${className ? ` ${className}` : ""}`}
      viewBox="0 0 24 24"
      style={size ? { width: size, height: size } : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
