/**
 * Le JSON `export_video` (API REST et outil MCP) qui produit EXACTEMENT la même chose que le
 * formulaire : mêmes réglages, mêmes plages (déjà protégées par le souffle), mêmes noms. Affiché
 * dans le bloc « Même export par l'API » : l'humain et l'agent manipulent les mêmes notions.
 *
 * L'API garde ses options à plat (tailles en points, hauteur du texte, « remplir ») pour ses appelants.
 * Le modèle de mise en page à blocs en dit davantage (zones déplacées, fonds de texte, sourate et verset
 * masqués) : ces réglages fins ne sont ajoutés au JSON (`layouts`, `styles`, `show_ref`) QUE quand les
 * options à plat ne suffisent pas à les redonner — le JSON reste court pour un export ordinaire, et
 * l'export lancé depuis l'atelier (rendu sur le serveur, par ce même JSON) est toujours celui de l'aperçu.
 * Reste hors de portée de l'API : la vidéo de fond (le fichier reste sur l'appareil), listée par
 * `apiDifferences`.
 */
import { BACKGROUND_PRESETS } from "./export-video-backgrounds";
import { isWhole, type PlanRange } from "./export-video-plan";
import {
  TEXT_BASE_SIZE,
  textStackPosition,
  type LayoutKey,
} from "./export-video-model";
import type { VideoPrefs } from "./export-video-prefs";
import { DEFAULT_LEAD_IN, DEFAULT_TAIL_OUT } from "./export-video-suggest";
import {
  videoPrefsFromOptions,
  type VideoJobOptions,
} from "./video-job-options";

const KNOWN_BACKGROUNDS = new Set<string>([
  ...BACKGROUND_PRESETS.map((p) => p.id),
  "source",
  "color",
]);

/** Bornes de l'API pour les tailles en points. */
const API_SIZE = {
  arabic: { min: 40, max: 240 },
  translation: { min: 16, max: 140 },
} as const;
const clampInt = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

/** Forme de cadre dont l'API lit la hauteur du texte : « comme la vidéo » suit le paysage. */
const apiLayoutKey = (prefs: VideoPrefs): LayoutKey =>
  prefs.orientation === "source" ? "16:9" : prefs.orientation;

export function exportVideoRequest(
  prefs: VideoPrefs,
  ranges: readonly PlanRange[],
  duration: number,
  fileName?: string,
): VideoJobOptions {
  const key = apiLayoutKey(prefs);
  const body: VideoJobOptions = {
    orientation: prefs.orientation,
    resolution: prefs.resolution,
    fps: prefs.fps,
    arabic_size: clampInt(
      prefs.styles.arabic.size * TEXT_BASE_SIZE.arabic,
      API_SIZE.arabic.min,
      API_SIZE.arabic.max,
    ),
    translation_size: clampInt(
      prefs.styles.translation.size * TEXT_BASE_SIZE.translation,
      API_SIZE.translation.min,
      API_SIZE.translation.max,
    ),
    show_translation: prefs.showTranslation,
    show_arabic: prefs.showArabic,
    show_wave: prefs.showWave,
    text_position: Math.round(
      textStackPosition(prefs.layouts[key], key, prefs.showWave) * 100,
    ),
    fill: prefs.styles.arabic.fill,
  };
  if (prefs.accent) body.accent = prefs.accent;
  // Le souffle est déjà appliqué aux plages ; il n'est repris que s'il diffère des défauts,
  // pour qu'un agent qui relance une découpe (`suggest`) retrouve les mêmes marges.
  if (prefs.paddingBefore !== DEFAULT_LEAD_IN)
    body.lead_in = prefs.paddingBefore;
  if (prefs.paddingAfter !== DEFAULT_TAIL_OUT)
    body.tail_out = prefs.paddingAfter;
  if (!prefs.snapToSilence) body.snap_to_silence = false;
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
  // Réglages fins : seulement ce que les options à plat ne redonnent pas.
  const flat = videoPrefsFromOptions(body, false);
  if (!same(flat.layouts, prefs.layouts)) body.layouts = prefs.layouts;
  if (!same(flat.styles, prefs.styles)) body.styles = prefs.styles;
  if (flat.showRef !== prefs.showRef) body.show_ref = prefs.showRef;
  return body;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Ce que le JSON de l'API ne reproduit PAS des réglages choisis (une phrase par sujet, en français), pour
 * que « Même export par l'API » ne promette pas plus qu'il ne tient. Vide = l'API refait la même vidéo.
 * Méthode : on refait les réglages depuis le JSON, et on compare.
 */
export function apiDifferences(prefs: VideoPrefs): string[] {
  const out: string[] = [];
  if (prefs.background === "video")
    out.push(
      "La vidéo de fond (son fichier reste sur l'appareil : l'API ne la reçoit pas encore).",
    );
  const back = videoPrefsFromOptions(exportVideoRequest(prefs, [], 0), false);
  // Tout le reste doit repasser à l'identique ; sinon un réglage se perd entre l'aperçu et l'export.
  const { background: _a, backgroundVideo: _b, ...mine } = prefs;
  const { background: _c, backgroundVideo: _d, ...theirs } = back;
  if (!same(mine, theirs))
    out.push("Certains réglages ne passent pas par l'API.");
  return out;
}
