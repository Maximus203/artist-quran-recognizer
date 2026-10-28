/**
 * Poids et durée de rendu d'un export vidéo, affichés AVANT d'exporter : calculés plage par plage
 * (une vidéo chacune) avec la formule du rendu, puis comparés aux seuils de la configuration.
 */
import { EXPORT_VIDEO_CONFIG, type WeightLimits } from "./export-video-config";
import { h264Bitrate } from "./export-video-codecs";
import { estimateVideoMegabytes } from "./export-video-format";
import { formatDurationFr } from "./format";

export type WeightLevel = "ok" | "warn" | "danger";
export type Weight = { totalMb: number; maxFileMb: number };
export type Quality = { resolution: number; fps: number };

export function rangesWeight(
  size: { width: number; height: number },
  fps: number,
  durations: readonly number[],
): Weight {
  const bitrate = h264Bitrate(size.width, size.height, fps);
  let totalMb = 0;
  let maxFileMb = 0;
  for (const seconds of durations) {
    const mb = estimateVideoMegabytes(bitrate, seconds);
    totalMb += mb;
    maxFileMb = Math.max(maxFileMb, mb);
  }
  return { totalMb, maxFileMb };
}

export function weightLevel(
  weight: Weight,
  quality: Quality,
  limits: WeightLimits = EXPORT_VIDEO_CONFIG.weight,
): WeightLevel {
  if (weight.totalMb > limits.dangerMb || weight.maxFileMb > limits.fileDangerMb)
    return "danger";
  if (
    weight.totalMb > limits.warnMb ||
    (quality.resolution >= limits.alwaysHeavy.resolution &&
      quality.fps >= limits.alwaysHeavy.fps)
  )
    return "warn";
  return "ok";
}

const comma = (value: number, digits: number): string =>
  value.toFixed(digits).replace(".", ",");

/** « 81 Mo », « 3,4 Mo », « 2,9 Go ». */
export function megabytesFr(mb: number): string {
  if (mb >= 1000) return `${comma(mb / 1000, 1)} Go`;
  if (mb >= 10) return `${Math.round(mb)} Mo`;
  return `${comma(mb, 1)} Mo`;
}

/** Durée de rendu annoncée : estimée là où une règle existe, « plus de » ailleurs. */
export function renderTimeFr(
  exportedSeconds: number,
  quality: Quality,
  config = EXPORT_VIDEO_CONFIG.render,
): string {
  const base = formatDurationFr(exportedSeconds * config.secondsPerAudioSecond);
  const measured =
    quality.fps <= config.measuredMaxFps &&
    quality.resolution <= config.measuredMaxResolution;
  return measured ? `≈ ${base}` : `plus de ${base}`;
}
