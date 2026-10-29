/**
 * Les quelques icônes dont l'export a besoin en plus de celles de l'atelier (`../icons.tsx`) : tracé
 * 1,6 px à bouts ronds comme le reste, dessinées pour le projet, aucun paquet d'icônes tiers. Le style
 * (`svg.i`) vient de `base.css`.
 */
const PATHS = {
  "chev-l": <path d="M14.5 6l-6 6 6 6" />,
  "chev-r": <path d="M9.5 6l6 6-6 6" />,
  file: (
    <>
      <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z" />
      <path d="M14 3.5V8h4M9 12.5h6M9 16h6" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </>
  ),
  loop: (
    <>
      <path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7H17" />
      <path d="M14.5 4.5L17 7l-2.5 2.5" />
      <path d="M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5H7" />
      <path d="M9.5 19.5L7 17l2.5-2.5" />
    </>
  ),
  undo: <path d="M9 5.5L4.5 10 9 14.5M4.5 10H14a5 5 0 0 1 0 10h-3" />,
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4l9 15.5H3z" />
      <path d="M12 10v4.2M12 17v.01" />
    </>
  ),
  download: (
    <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
  ),
  refresh: (
    <path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3L20 15.5M20 20v-4.5h-4.5" />
  ),
  play: (
    <path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" />
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />,
  pause: <path d="M8.5 5.5v13M15.5 5.5v13" />,
  /** Crochets de la sélection (frise). */
  brackets: <path d="M8 4.5H5.5v15H8M16 4.5h2.5v15H16" />,
  /** Passages : une rangée de cases. */
  passages: (
    <>
      <rect x="3.5" y="8.5" width="5" height="7" rx="1" />
      <rect x="10" y="8.5" width="4" height="7" rx="1" />
      <rect x="15.5" y="8.5" width="5" height="7" rx="1" />
    </>
  ),
  wave: <path d="M3.5 12h1M7 8.5v7M10.5 5.5v13M14 9v6M17.5 7v10M20.5 12h0" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  "zoom-in": (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5M10.5 8v5" />
    </>
  ),
  "zoom-out": (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5M8 10.5h5" />
    </>
  ),
  fit: (
    <path d="M4.5 9V5.5a1 1 0 0 1 1-1H9M15 4.5h3.5a1 1 0 0 1 1 1V9M19.5 15v3.5a1 1 0 0 1-1 1H15M9 19.5H5.5a1 1 0 0 1-1-1V15" />
  ),
  pen: <path d="M14.5 5.5l4 4L9 19H5v-4zM12.5 7.5l4 4" />,
  up: <path d="M6.5 14.5L12 9l5.5 5.5" />,
  down: <path d="M6.5 9.5L12 15l5.5-5.5" />,
  trash: (
    <path d="M5 7h14M10 7V5h4v2M7 7l1 12.5h8L17 7M10.5 10.5v6M13.5 10.5v6" />
  ),
  braces: (
    <path d="M9 4.5c-2 0-2.5 1-2.5 3v2c0 1.5-.8 2.5-2 2.5 1.2 0 2 1 2 2.5v2c0 2 .5 3 2.5 3M15 4.5c2 0 2.5 1 2.5 3v2c0 1.5.8 2.5 2 2.5-1.2 0-2 1-2 2.5v2c0 2-.5 3-2.5 3" />
  ),
  film: (
    <>
      <rect x="4" y="5.5" width="16" height="13" rx="2" />
      <path d="M8 5.5v13M16 5.5v13M4 9.5h4M4 14.5h4M16 9.5h4M16 14.5h4" />
    </>
  ),
  subtitle: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M7 13.5h4M13 13.5h4M7 16h10" />
    </>
  ),
  /** Porte : la vérification est un passage, pas une étape. */
  door: (
    <>
      <path d="M6.5 20V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v15M4.5 20h15" />
      <path d="M14 12.5v.01" />
    </>
  ),
  magnet: (
    <path d="M6 4.5v7a6 6 0 0 0 12 0v-7h-3.5v7a2.5 2.5 0 0 1-5 0v-7zM6 8h3.5M14.5 8H18" />
  ),
} as const;

export type XIconName = keyof typeof PATHS;

export function XIcon({
  name,
  size,
  className,
}: {
  name: XIconName;
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

/** Losange de la correction humaine : plein = ta décision, creux = ce que le moteur a dit (sans la couleur). */
export function Diamond({ hollow = false }: { hollow?: boolean }) {
  return <i className={`dia${hollow ? " hollow" : ""}`} aria-hidden="true" />;
}
