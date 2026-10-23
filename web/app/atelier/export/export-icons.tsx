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
