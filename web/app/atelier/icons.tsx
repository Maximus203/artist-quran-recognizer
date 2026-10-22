/**
 * Icônes dessinées pour le projet (trait 1,6 px, bouts ronds) : aucun paquet d'icônes tiers.
 * Un sprite unique (`IconSprite`) est monté une fois ; `Icon` y renvoie par `<use>`.
 */
export type IconName =
  | "panel-l"
  | "panel-r"
  | "play"
  | "pause"
  | "mic"
  | "upload"
  | "audio"
  | "video"
  | "check"
  | "x"
  | "alert"
  | "info"
  | "refresh"
  | "flag"
  | "sun"
  | "moon"
  | "plus"
  | "download"
  | "gauge"
  | "target"
  | "edit"
  | "wave"
  | "stop";

export function IconSprite() {
  return (
    <svg
      width="0"
      height="0"
      style={{ position: "absolute" }}
      aria-hidden="true"
      focusable="false"
    >
      <symbol id="i-panel-l" viewBox="0 0 24 24">
        <rect x="3" y="4.5" width="18" height="15" rx="3" />
        <path d="M9.5 4.5v15" />
      </symbol>
      <symbol id="i-panel-r" viewBox="0 0 24 24">
        <rect x="3" y="4.5" width="18" height="15" rx="3" />
        <path d="M14.5 4.5v15" />
      </symbol>
      <symbol id="i-play" viewBox="0 0 24 24">
        <path d="M8 5.2v13.6a.6.6 0 0 0 .9.5l10.6-6.8a.6.6 0 0 0 0-1L8.9 4.7a.6.6 0 0 0-.9.5z" />
      </symbol>
      <symbol id="i-pause" viewBox="0 0 24 24">
        <rect x="6.5" y="5" width="3.8" height="14" rx="1" />
        <rect x="13.7" y="5" width="3.8" height="14" rx="1" />
      </symbol>
      <symbol id="i-stop" viewBox="0 0 24 24">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </symbol>
      <symbol id="i-mic" viewBox="0 0 24 24">
        <rect x="9" y="3" width="6" height="11" rx="3" />
        <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21m-3.5 0h7" />
      </symbol>
      <symbol id="i-upload" viewBox="0 0 24 24">
        <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
      </symbol>
      <symbol id="i-audio" viewBox="0 0 24 24">
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
      </symbol>
      <symbol id="i-video" viewBox="0 0 24 24">
        <rect x="3" y="6" width="13" height="12" rx="2.5" />
        <path d="M16 10.5l5-3v9l-5-3" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24">
        <path d="M6 6l12 12M18 6L6 18" />
      </symbol>
      <symbol id="i-alert" viewBox="0 0 24 24">
        <path d="M12 4l9 15.5H3z" />
        <path d="M12 10v4.2M12 17v.01" />
      </symbol>
      <symbol id="i-info" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5M12 8v.01" />
      </symbol>
      <symbol id="i-refresh" viewBox="0 0 24 24">
        <path d="M20 11a8 8 0 0 0-14.3-4.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 14.3 4.3L20 15.5M20 20v-4.5h-4.5" />
      </symbol>
      <symbol id="i-flag" viewBox="0 0 24 24">
        <path d="M6 21V4m0 0h11l-2.5 4L17 12H6" />
      </symbol>
      <symbol id="i-sun" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
      </symbol>
      <symbol id="i-moon" viewBox="0 0 24 24">
        <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
      </symbol>
      <symbol id="i-plus" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" />
      </symbol>
      <symbol id="i-download" viewBox="0 0 24 24">
        <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M4 17v1a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1" />
      </symbol>
      <symbol id="i-gauge" viewBox="0 0 24 24">
        <path d="M4 16a8 8 0 1 1 16 0M12 16l4-5" />
      </symbol>
      <symbol id="i-target" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="6.5" />
        <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
      </symbol>
      <symbol id="i-edit" viewBox="0 0 24 24">
        <path d="M4 20l1-4.5L16.5 4a2 2 0 0 1 3 3L8 18.5zM14.5 6l3.5 3.5" />
      </symbol>
      <symbol id="i-wave" viewBox="0 0 24 24">
        <path d="M3 12h2l2-6 3 12 3-9 2 5 2-2h4" />
      </symbol>
    </svg>
  );
}

export function Icon({
  name,
  fill = false,
  size,
  className,
}: {
  name: IconName;
  fill?: boolean;
  /** Côté en px quand il diffère des 20 px par défaut. */
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`i${fill ? " fill" : ""}${className ? ` ${className}` : ""}`}
      style={size ? { width: size, height: size } : undefined}
      aria-hidden="true"
      focusable="false"
    >
      <use href={`#i-${name}`} />
    </svg>
  );
}

/** Glyphe d'état d'une session : la FORME porte le sens (anneau, pointillé, arc, coche, triangle, barré). */
export function SessionGlyph({
  state,
  rank,
  progress,
}: {
  state: "ready" | "queued" | "running" | "done" | "failed" | "cancelled";
  rank: number | null;
  /** 0 à 0,95 ; null = indéterminé. */
  progress: number | null;
}) {
  const circumference = 56.55; // 2 π r, r = 9
  if (state === "running")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="ring-track" cx="12" cy="12" r="9" />
        <circle
          className="ring-arc"
          cx="12"
          cy="12"
          r="9"
          strokeDasharray={`${(progress ?? 0.25) * circumference} ${circumference}`}
        />
      </svg>
    );
  if (state === "queued")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="ring-dash" cx="12" cy="12" r="9" />
        <text className="ring-n" x="12" y="15.6" textAnchor="middle">
          {rank ?? ""}
        </text>
      </svg>
    );
  if (state === "failed")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 4l9 15.5H3z" />
        <path d="M12 10v4.2M12 17v.01" />
      </svg>
    );
  if (state === "cancelled")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M6 18L18 6" />
      </svg>
    );
  if (state === "done")
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12.4l2.7 2.7L16.2 9.4" strokeWidth="1.8" />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}
