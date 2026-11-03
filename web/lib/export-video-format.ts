import {
  even,
  orientationSize,
  type VideoOrientation,
} from "./export-video-args";

/**
 * Qualité de l'export vidéo : cadence (30 ou 60 images par seconde) et résolution, comptée
 * sur le côté COURT de l'image (720 = 1280×720 en 16:9, 720×1280 en 9:16, 720×720 en carré).
 * Plus de pixels et plus d'images rendent la vidéo plus fine et plus fluide, mais aussi plus lourde
 * et plus longue à produire.
 */
export const VIDEO_FPS_CHOICES = [30, 60] as const;
export type VideoFps = (typeof VIDEO_FPS_CHOICES)[number];
export const DEFAULT_VIDEO_FPS: VideoFps = 30;

export const VIDEO_RESOLUTIONS = [
  { short: 360, label: "360p" },
  { short: 480, label: "480p" },
  { short: 720, label: "720p (HD)" },
  { short: 1080, label: "1080p (Full HD)" },
] as const;
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number]["short"];
export const DEFAULT_VIDEO_RESOLUTION: VideoResolution = 1080;
export const VIDEO_RESOLUTION_VALUES: readonly VideoResolution[] =
  VIDEO_RESOLUTIONS.map((r) => r.short);
/**
 * Plafond : le rendu se fait sur le serveur (partagé, 2 cœurs, 2 Go) ; au-delà du 1080p le temps de rendu et la
 * mémoire explosent pour un gain invisible sur un écran de téléphone ou de partage.
 */
export const MAX_VIDEO_RESOLUTION: VideoResolution = 1080;
/** Valeurs qu'un ancien réglage enregistré peut encore porter : elles sont ramenées au plafond, pas refusées. */
export const LEGACY_VIDEO_RESOLUTIONS: readonly number[] = [
  ...VIDEO_RESOLUTION_VALUES,
  1440,
  2160,
];
/** Résolution d'un réglage enregistré, jamais au-dessus du plafond. */
export const capResolution = (value: number): VideoResolution =>
  Math.min(value, MAX_VIDEO_RESOLUTION) as VideoResolution;

/**
 * Paliers de qualité proposés en un geste : chacun affiche le poids des plages choisies. « Sur
 * mesure » garde les quatre résolutions (jusqu'au 1080p) × 30/60 im/s.
 */
export const VIDEO_QUALITY_TIERS = [
  { id: "light", label: "Léger", usage: "Messagerie, téléphone", resolution: 720, fps: 30 },
  { id: "standard", label: "Standard", usage: "YouTube, partage", resolution: 1080, fps: 30 },
  { id: "smooth", label: "Fluide", usage: "Mouvements plus doux", resolution: 1080, fps: 60 },
] as const satisfies readonly {
  id: string;
  label: string;
  usage: string;
  resolution: VideoResolution;
  fps: VideoFps;
}[]; // prettier-ignore
export type VideoQualityTier = (typeof VIDEO_QUALITY_TIERS)[number];

/** Palier correspondant à une qualité, null si elle est « sur mesure ». */
export function tierOf(
  resolution: number,
  fps: number,
): VideoQualityTier | null {
  return (
    VIDEO_QUALITY_TIERS.find(
      (t) => t.resolution === resolution && t.fps === fps,
    ) ?? null
  );
}

/** Dimensions (paires) de la vidéo : format choisi ramené au côté court demandé. */
export function videoDimensions(
  orientation: VideoOrientation,
  shortSide: number,
  source: { width: number; height: number } | null = null,
): { width: number; height: number } {
  const ratio = source
    ? source.width / source.height
    : (() => {
        const base = orientationSize(orientation);
        return base.width / base.height;
      })();
  return ratio >= 1
    ? { width: even(shortSide * ratio), height: even(shortSide) }
    : { width: even(shortSide), height: even(shortSide / ratio) };
}

/** Poids approximatif du MP4 : débit vidéo cible + 128 kbit/s de son, en mégaoctets. */
export const estimateVideoMegabytes = (
  videoBitrate: number,
  seconds: number,
): number =>
  Math.max(0.1, ((videoBitrate + 128_000) * seconds) / 8 / 1_000_000);
