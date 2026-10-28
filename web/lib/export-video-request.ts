/**
 * Le JSON `export_video` (API REST et outil MCP) qui produit EXACTEMENT la même chose que le
 * formulaire : mêmes réglages, mêmes plages (déjà protégées par le souffle), mêmes noms. Affiché
 * dans le bloc « Même export par l'API » : l'humain et l'agent manipulent les mêmes notions.
 */
import { BACKGROUND_PRESETS } from "./export-video-backgrounds";
import { isWhole, type PlanRange } from "./export-video-plan";
import type { VideoPrefs } from "./export-video-prefs";
import type { VideoJobOptions } from "./video-job-options";

const KNOWN_BACKGROUNDS = new Set<string>([
  ...BACKGROUND_PRESETS.map((p) => p.id),
  "source",
  "color",
]);

export function exportVideoRequest(
  prefs: VideoPrefs,
  ranges: readonly PlanRange[],
  duration: number,
  fileName?: string,
): VideoJobOptions {
  const body: VideoJobOptions = {
    orientation: prefs.orientation,
    resolution: prefs.resolution,
    fps: prefs.fps,
    arabic_size: prefs.arabicSize,
    translation_size: prefs.translationSize,
    show_translation: prefs.showTranslation,
    show_wave: prefs.showWave,
    text_position: prefs.textPosition,
    fill: prefs.fill,
  };
  if (prefs.accent) body.accent = prefs.accent;
  if (prefs.background && KNOWN_BACKGROUNDS.has(prefs.background))
    body.background = prefs.background as VideoJobOptions["background"];
  if (prefs.background === "color") body.color = prefs.bg;
  const whole = ranges.length === 1 && isWhole(ranges[0], duration);
  if (ranges.length > 0 && !whole)
    body.ranges = ranges.map((r) =>
      r.name.trim()
        ? { start: r.start, end: r.end, name: r.name.trim() }
        : { start: r.start, end: r.end },
    );
  if (fileName?.trim()) body.file_name = fileName.trim();
  return body;
}
