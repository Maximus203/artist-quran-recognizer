/**
 * Les pictogrammes propres à la table de montage, en plus de ceux de l'éditeur (`editor-icons.tsx`) : dessinés
 * pour le projet, tracé de 1,6 px à bouts ronds (le style `svg.i` vient de `base.css`). Aucun paquet tiers.
 */
const PATHS = {
  /** Aide : un point d'interrogation dans un rond. */
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 1.8M12 16.6v.01" />
    </>
  ),
  /** Passage précédent : une barre et une flèche vers la gauche. */
  "skip-prev": <path d="M6.5 5.5v13M18 6l-8 6 8 6z" />,
  /** Passage suivant. */
  "skip-next": <path d="M17.5 5.5v13M6 6l8 6-8 6z" />,
  /** Un pas en arrière. */
  back: <path d="M14.5 6.5L9 12l5.5 5.5" />,
  /** Un pas en avant. */
  forward: <path d="M9.5 6.5L15 12l-5.5 5.5" />,
  /** Voir de plus près : une loupe avec un plus. */
  "zoom-in": (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M10.5 8v5M8 10.5h5" />
    </>
  ),
  /** Voir plus large : une loupe avec un moins. */
  "zoom-out": (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5" />
    </>
  ),
  /** Retour à la chronologie. */
  "chev-left": <path d="M14.5 6l-6 6 6 6" />,
} as const;

export type TableIconName = keyof typeof PATHS;

export function TIcon({ name, size }: { name: TableIconName; size?: number }) {
  return (
    <svg
      className="i"
      viewBox="0 0 24 24"
      style={size ? { width: size, height: size } : undefined}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
