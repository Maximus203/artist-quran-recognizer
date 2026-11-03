"use client";
import { EXPORT_VIDEO_CONFIG } from "@/lib/export-video-config";
import {
  tierOf,
  VIDEO_FPS_CHOICES,
  VIDEO_QUALITY_TIERS,
  VIDEO_RESOLUTIONS,
  type VideoFps,
  type VideoResolution,
} from "@/lib/export-video-format";
import {
  megabytesFr,
  weightLevel,
  type Weight,
  type WeightLevel,
} from "@/lib/export-video-weight";
import { formatDurationFr } from "@/lib/format";
import { XIcon } from "./export-icons";
import { rovingKeys, Segmented } from "./export-ui";

/**
 * Qualité et poids : cinq paliers qui affichent chacun le poids TOTAL des plages choisies, une
 * jauge (motif + libellé, jamais la couleur seule) et « Sur mesure » replié (6 résolutions × 30/60).
 */
const LIMITS = EXPORT_VIDEO_CONFIG.weight;

export const LEVEL_LABEL: Record<WeightLevel, string> = {
  ok: "",
  warn: "lourd",
  danger: "très lourd",
};

export function QualityTiers({
  resolution,
  fps,
  weightFor,
  onPick,
}: {
  resolution: VideoResolution;
  fps: VideoFps;
  weightFor: (resolution: number, fps: number) => Weight;
  onPick: (resolution: VideoResolution, fps: VideoFps) => void;
}) {
  return (
    <div
      className="xr-tiers"
      role="radiogroup"
      aria-label="Qualité de la vidéo"
      onKeyDown={rovingKeys}
    >
      {VIDEO_QUALITY_TIERS.map((tier) => {
        const on = tier.resolution === resolution && tier.fps === fps;
        const w = weightFor(tier.resolution, tier.fps);
        const level = weightLevel(w, tier);
        return (
          <button
            key={tier.id}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={
              on || (!tierOf(resolution, fps) && tier.id === "standard")
                ? 0
                : -1
            }
            className="xr-tier"
            data-heavy={level === "ok" ? undefined : level}
            data-testid={`video-tier-${tier.id}`}
            onClick={() => onPick(tier.resolution, tier.fps)}
          >
            <b>{tier.label}</b>
            <span className="spec">
              {tier.resolution}p · {tier.fps} im/s
            </span>
            <small>{tier.usage}</small>
            <span className="wt">
              ≈ {megabytesFr(w.totalMb)}
              {level !== "ok" ? <small> {LEVEL_LABEL[level]}</small> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function WeightGauge({
  weight,
  level,
  seconds,
  width,
  height,
  fps,
}: {
  weight: Weight;
  level: WeightLevel;
  seconds: number;
  width: number;
  height: number;
  fps: number;
}) {
  const pct = (mb: number) =>
    `${Math.min(100, Math.max(0, (mb / LIMITS.gaugeMaxMb) * 100))}%`;
  return (
    <>
      <div className="xr-gauge" data-level={level} data-testid="video-gauge">
        <div
          className="bar"
          role="meter"
          aria-label="Poids estimé"
          aria-valuemin={0}
          aria-valuemax={LIMITS.gaugeMaxMb}
          aria-valuenow={Math.round(weight.totalMb)}
          aria-valuetext={`≈ ${megabytesFr(weight.totalMb)}${level !== "ok" ? `, ${LEVEL_LABEL[level]}` : ""}`}
        >
          <i style={{ width: `max(2%, ${pct(weight.totalMb)})` }} />
        </div>
        <div className="ticks" aria-hidden="true">
          <span style={{ left: 0 }}>0</span>
          <span style={{ left: pct(LIMITS.warnMb) }}>
            {megabytesFr(LIMITS.warnMb)}
          </span>
          <span style={{ left: pct(LIMITS.dangerMb) }}>
            {megabytesFr(LIMITS.dangerMb)}
          </span>
          <span style={{ right: 0 }}>{megabytesFr(LIMITS.gaugeMaxMb)}</span>
        </div>
      </div>
      <p
        className={`xr-note${level === "ok" ? "" : ` xr-note--${level}`}`}
        data-testid="video-weight-note"
      >
        <XIcon name={level === "ok" ? "check" : "alert"} />
        {level === "ok" ? (
          <span>
            <b>≈ {megabytesFr(weight.totalMb)} au total</b> pour{" "}
            {formatDurationFr(seconds)} de vidéo (image {width} × {height},{" "}
            {fps} im/s). Facile à envoyer.
          </span>
        ) : (
          <span>
            <b>
              {level === "danger" ? "Très lourd" : "Lourd"} : ≈{" "}
              {megabytesFr(weight.totalMb)}.
            </b>{" "}
            La vidéo se fabrique dans ce navigateur, qui garde tout en mémoire
            pendant le rendu : sur téléphone, il peut s’arrêter en route.{" "}
            {height >= 1440 || width >= 2560
              ? "1080p reste net sur presque tous les écrans."
              : "Raccourcis les plages ou baisse la fluidité."}
          </span>
        )}
      </p>
    </>
  );
}

export function CustomQuality({
  resolution,
  fps,
  onResolution,
  onFps,
}: {
  resolution: VideoResolution;
  fps: VideoFps;
  onResolution: (value: VideoResolution) => void;
  onFps: (value: VideoFps) => void;
}) {
  return (
    <details className="xr-fine" open={!tierOf(resolution, fps) || undefined}>
      <summary>
        <XIcon name="chev-r" />
        Sur mesure : résolution et fluidité
      </summary>
      <div>
        <div className="xr-field">
          <span className="xr-cap">Résolution</span>
          <Segmented
            label="Résolution de la vidéo"
            items={VIDEO_RESOLUTIONS.map((r) => ({
              value: r.short,
              label: r.label,
            }))}
            value={resolution}
            onPick={onResolution}
            testId="video-resolution"
          />
        </div>
        <div className="xr-field">
          <span className="xr-cap">Fluidité</span>
          <Segmented
            label="Images par seconde"
            items={VIDEO_FPS_CHOICES.map((value) => ({
              value,
              label: value === 60 ? "60 im/s · plus fluide" : "30 im/s",
            }))}
            value={fps}
            onPick={onFps}
            testId="video-fps"
          />
        </div>
      </div>
    </details>
  );
}
