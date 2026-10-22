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
  | "stop"
  | "seek-back"
  | "seek-fwd"
  | "star"
  | "archive"
  | "search"
  | "sliders"
  | "calendar"
  | "chevron-d"
  | "chevron-r"
  | "lock"
  | "globe"
  | "users"
  | "user"
  | "logout"
  | "eye"
  | "eye-off"
  | "book"
  | "file"
  | "clock"
  | "drive"
  | "more"
  | "branch"
  | "arrow-r"
  | "arrow-l"
  | "chart"
  | "sort"
  | "trash"
  | "undo"
  | "list"
  | "code"
  | "signpost"
  | "menu"
  | "copy"
  | "shield"
  | "key"
  | "home"
  | "filter-x";

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
      <symbol id="i-seek-back" viewBox="0 0 24 24">
        <path d="M6.7 7.7A7.5 7.5 0 1 0 12 5.5" />
        <path d="M14.6 3L12 5.5 14.6 8" />
        <path d="M14 10.6h-2.9l-.5 2.5c.35-.25.8-.4 1.3-.4 1.2 0 2 .8 2 1.9 0 1.2-.9 2-2.2 2-.7 0-1.3-.2-1.8-.7" />
      </symbol>
      <symbol id="i-seek-fwd" viewBox="0 0 24 24">
        <g transform="translate(24 0) scale(-1 1)">
          <path d="M6.7 7.7A7.5 7.5 0 1 0 12 5.5" />
          <path d="M14.6 3L12 5.5 14.6 8" />
        </g>
        <path d="M14 10.6h-2.9l-.5 2.5c.35-.25.8-.4 1.3-.4 1.2 0 2 .8 2 1.9 0 1.2-.9 2-2.2 2-.7 0-1.3-.2-1.8-.7" />
      </symbol>
      <symbol id="i-star" viewBox="0 0 24 24">
        <path d="M12 3.8l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.7-4.8 2.7 1-5.4-4-3.7 5.4-.7z" />
      </symbol>
      <symbol id="i-archive" viewBox="0 0 24 24">
        <rect x="3.5" y="5" width="17" height="4.5" rx="1.5" />
        <path d="M5 9.5V18a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18V9.5M10 13.5h4" />
      </symbol>
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M15.5 15.5L20 20" />
      </symbol>
      <symbol id="i-sliders" viewBox="0 0 24 24">
        <path d="M4 7h8M16 7h4M4 17h3M11 17h9" />
        <circle cx="14" cy="7" r="2" />
        <circle cx="9" cy="17" r="2" />
      </symbol>
      <symbol id="i-calendar" viewBox="0 0 24 24">
        <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" />
        <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
      </symbol>
      <symbol id="i-chevron-d" viewBox="0 0 24 24">
        <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
      </symbol>
      <symbol id="i-chevron-r" viewBox="0 0 24 24">
        <path d="M9.5 6.5l5.5 5.5-5.5 5.5" />
      </symbol>
      <symbol id="i-lock" viewBox="0 0 24 24">
        <rect x="5.5" y="10.5" width="13" height="9.5" rx="2.5" />
        <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
      </symbol>
      <symbol id="i-globe" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5c2.6 2.4 3.6 5.3 3.6 8.5s-1 6.1-3.6 8.5c-2.6-2.4-3.6-5.3-3.6-8.5s1-6.1 3.6-8.5z" />
      </symbol>
      <symbol id="i-users" viewBox="0 0 24 24">
        <circle cx="9" cy="8.5" r="3.2" />
        <path d="M3 19.5c.6-3.3 3-5 6-5s5.4 1.7 6 5M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c2 .5 3.2 2.1 3.5 4.7" />
      </symbol>
      <symbol id="i-user" viewBox="0 0 24 24">
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20c.7-3.7 3.5-5.5 7-5.5s6.3 1.8 7 5.5" />
      </symbol>
      <symbol id="i-logout" viewBox="0 0 24 24">
        <path d="M10 4.5H7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h3M14 8l4 4-4 4M18 12H9.5" />
      </symbol>
      <symbol id="i-eye" viewBox="0 0 24 24">
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
        <circle cx="12" cy="12" r="2.8" />
      </symbol>
      <symbol id="i-eye-off" viewBox="0 0 24 24">
        <path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .5 4.2 1.2M21.5 12S18 18.5 12 18.5c-1.6 0-3-.5-4.2-1.2" />
        <path d="M9.9 9.9a2.8 2.8 0 0 0 4.2 4.2M4 4l16 16" />
      </symbol>
      <symbol id="i-book" viewBox="0 0 24 24">
        <path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z" />
        <path d="M5 17a3 3 0 0 1 3-3h10" />
      </symbol>
      <symbol id="i-file" viewBox="0 0 24 24">
        <path d="M7 3.5h7l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" />
        <path d="M14 3.5v4h4M8.5 12h7M8.5 15.5h7" />
      </symbol>
      <symbol id="i-clock" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </symbol>
      <symbol id="i-drive" viewBox="0 0 24 24">
        <path d="M4 14h16M4 14l2-7.5A2 2 0 0 1 7.9 5h8.2A2 2 0 0 1 18 6.5L20 14v3.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
        <path d="M7.5 16.5h.01M11 16.5h.01" />
      </symbol>
      <symbol id="i-more" viewBox="0 0 24 24">
        <circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        <circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      </symbol>
      <symbol id="i-branch" viewBox="0 0 24 24">
        <circle cx="6" cy="5.5" r="2" />
        <circle cx="6" cy="18.5" r="2" />
        <circle cx="18" cy="18.5" r="2" />
        <path d="M6 7.5v9M18 16.5V10a3 3 0 0 0-3-3h-2.5M15 4.5l-2.5 2.5L15 9.5" />
      </symbol>
      <symbol id="i-arrow-r" viewBox="0 0 24 24">
        <path d="M5 12h14M13 6l6 6-6 6" />
      </symbol>
      <symbol id="i-arrow-l" viewBox="0 0 24 24">
        <path d="M19 12H5M11 6l-6 6 6 6" />
      </symbol>
      <symbol id="i-chart" viewBox="0 0 24 24">
        <path d="M5 19v-8M12 19V5M19 19v-5" />
      </symbol>
      <symbol id="i-sort" viewBox="0 0 24 24">
        <path d="M8 19V5M8 19l-3-3M8 19l3-3M16 5v14M16 5l-3 3M16 5l3 3" />
      </symbol>
      <symbol id="i-trash" viewBox="0 0 24 24">
        <path d="M5 7h14M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L17 7" />
      </symbol>
      <symbol id="i-undo" viewBox="0 0 24 24">
        <path d="M9 7L5 11l4 4M5 11h9a5 5 0 0 1 0 10h-3" />
      </symbol>
      <symbol id="i-list" viewBox="0 0 24 24">
        <path d="M8 6.5h12M8 12h12M8 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" />
      </symbol>
      <symbol id="i-code" viewBox="0 0 24 24">
        <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
      </symbol>
      <symbol id="i-signpost" viewBox="0 0 24 24">
        <path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z" />
        <path d="M8.8 12.2l2.2 2.2 4.2-4.2" />
      </symbol>
      <symbol id="i-menu" viewBox="0 0 24 24">
        <path d="M4 7h16M4 12h16M4 17h16" />
      </symbol>
      <symbol id="i-copy" viewBox="0 0 24 24">
        <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
        <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
      </symbol>
      <symbol id="i-shield" viewBox="0 0 24 24">
        <path d="M12 3.5l7 2.5v5.5c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6z" />
        <path d="M9 12l2.2 2.2L15.5 10" />
      </symbol>
      <symbol id="i-key" viewBox="0 0 24 24">
        <circle cx="8" cy="15" r="3.5" />
        <path d="M10.5 12.5L19 4M16 7l2.5 2.5M13.5 9.5L15 11" />
      </symbol>
      <symbol id="i-home" viewBox="0 0 24 24">
        <path d="M4 11l8-6.5 8 6.5M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5" />
      </symbol>
      <symbol id="i-filter-x" viewBox="0 0 24 24">
        <path d="M4 5h16l-6 7v6l-4 2v-8z" />
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
