"use client";
import { formatTimeInput } from "@/lib/export-video-ranges";
import type { RangeRow } from "@/lib/export-video-ranges";
import {
  VIDEO_FPS_CHOICES,
  VIDEO_RESOLUTIONS,
  type VideoFps,
  type VideoResolution,
} from "@/lib/export-video-format";

/**
 * Deux blocs du formulaire vidéo : la qualité (résolution, images par seconde, poids estimé) et
 * les parties à exporter (tout l'audio, des plages choisies, ou un verset par vidéo).
 */

export function VideoQuality({
  resolution,
  fps,
  width,
  height,
  megabytes,
  onResolution,
  onFps,
}: {
  resolution: VideoResolution;
  fps: VideoFps;
  width: number;
  height: number;
  megabytes: number | null;
  onResolution: (value: VideoResolution) => void;
  onFps: (value: VideoFps) => void;
}) {
  return (
    <fieldset className="ex-video-row" data-testid="video-quality">
      <legend className="ex-video-legend">5 · Qualité</legend>
      <div className="ex-video-size">
        <span className="ex-video-size-label">Résolution</span>
        <div
          className="ex-seg-tabs ex-seg-tabs--wrap"
          role="radiogroup"
          aria-label="Résolution de la vidéo"
        >
          {VIDEO_RESOLUTIONS.map((item) => (
            <button
              key={item.short}
              type="button"
              role="radio"
              aria-checked={resolution === item.short}
              data-testid={`video-resolution-${item.short}`}
              className={resolution === item.short ? "is-active" : undefined}
              onClick={() => onResolution(item.short)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="ex-video-size">
        <span className="ex-video-size-label">Fluidité</span>
        <div
          className="ex-seg-tabs"
          role="radiogroup"
          aria-label="Images par seconde"
        >
          {VIDEO_FPS_CHOICES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={fps === value}
              data-testid={`video-fps-${value}`}
              className={fps === value ? "is-active" : undefined}
              onClick={() => onFps(value)}
            >
              {value} im/s
              {value === 60 ? " · plus fluide" : ""}
            </button>
          ))}
        </div>
      </div>
      <p className="ex-micro" data-testid="video-quality-note">
        Image {width} × {height}, {fps} images par seconde
        {megabytes !== null
          ? ` : environ ${megabytes < 10 ? megabytes.toFixed(1).replace(".", ",") : Math.round(megabytes)} Mo au total.`
          : "."}{" "}
        Plus la résolution et la fluidité montent, plus le fichier est lourd et
        le rendu long.
      </p>
    </fieldset>
  );
}

export type RangeMode = "all" | "ranges" | "verses";

export function VideoRanges({
  mode,
  rows,
  duration,
  error,
  verseCount,
  onMode,
  onRows,
}: {
  mode: RangeMode;
  rows: RangeRow[];
  duration: number | null;
  error: string | null;
  verseCount: number;
  onMode: (mode: RangeMode) => void;
  onRows: (rows: RangeRow[]) => void;
}) {
  const nextId = () => rows.reduce((max, row) => Math.max(max, row.id), 0) + 1;
  const parseEnd = (row: RangeRow | undefined): number => {
    const text = row?.end?.replace(",", ".") ?? "";
    const parts = text.split(":").map(Number);
    return parts.every(Number.isFinite)
      ? parts.reduce((total, part) => total * 60 + part, 0)
      : 0;
  };
  const add = () => {
    const start = rows.length > 0 ? parseEnd(rows[rows.length - 1]) : 0;
    const end = duration ? Math.min(start + 30, duration) : start + 30;
    onRows([
      ...rows,
      {
        id: nextId(),
        start: formatTimeInput(start),
        end: formatTimeInput(end),
      },
    ]);
  };
  const patchRow = (id: number, next: Partial<RangeRow>) =>
    onRows(rows.map((row) => (row.id === id ? { ...row, ...next } : row)));

  const choose = (next: RangeMode) => {
    onMode(next);
    if (next === "ranges" && rows.length === 0) {
      const end = duration ? Math.min(30, duration) : 30;
      onRows([{ id: 1, start: "0:00", end: formatTimeInput(end) }]);
    }
  };

  return (
    <fieldset className="ex-video-row" data-testid="video-ranges">
      <legend className="ex-video-legend">6 · Parties à exporter</legend>
      <div
        className="ex-seg-tabs ex-seg-tabs--wrap"
        role="radiogroup"
        aria-label="Parties à exporter"
      >
        {(
          [
            ["all", "Tout l’audio"],
            ["ranges", "Des parties choisies"],
            ["verses", "Un verset = une vidéo"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={mode === id}
            data-testid={`video-range-mode-${id}`}
            className={mode === id ? "is-active" : undefined}
            onClick={() => choose(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "all" ? (
        <p className="ex-micro">
          Une seule vidéo, de la première à la dernière seconde.
        </p>
      ) : null}

      {mode === "verses" ? (
        <p className="ex-micro" data-testid="video-range-verses-note">
          {verseCount > 0
            ? `${verseCount} vidéo${verseCount > 1 ? "s" : ""} : une par verset reconnu, du début à la fin de sa récitation.`
            : "Aucun verset reconnu à découper."}
        </p>
      ) : null}

      {mode === "ranges" ? (
        <div className="ex-ranges">
          <p className="ex-micro">
            Chaque partie donne sa propre vidéo (début et fin comme 1:23). Le
            son et l’image ne gardent que ce passage.
            {duration
              ? ` Durée de l’audio : ${formatTimeInput(duration)}.`
              : ""}
          </p>
          {rows.map((row, index) => (
            <div
              key={row.id}
              className="ex-range-row"
              data-testid={`video-range-row-${index}`}
            >
              <span className="ex-range-num mono">{index + 1}</span>
              <label>
                <span className="ex-range-cap">Début</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.start}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="0:00"
                  data-testid={`video-range-start-${index}`}
                  onChange={(event) =>
                    patchRow(row.id, { start: event.target.value })
                  }
                />
              </label>
              <label>
                <span className="ex-range-cap">Fin</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={row.end}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="0:30"
                  data-testid={`video-range-end-${index}`}
                  onChange={(event) =>
                    patchRow(row.id, { end: event.target.value })
                  }
                />
              </label>
              <button
                type="button"
                className="btn btn--ghost"
                aria-label={`Retirer la partie ${index + 1}`}
                data-testid={`video-range-remove-${index}`}
                disabled={rows.length === 1}
                onClick={() => onRows(rows.filter((r) => r.id !== row.id))}
              >
                Retirer
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--ghost"
            data-testid="video-range-add"
            onClick={add}
          >
            + Ajouter une partie
          </button>
          {rows.length > 1 ? (
            <p className="ex-micro">
              {rows.length} vidéos seront téléchargées l’une après l’autre ;
              autorise les téléchargements multiples si le navigateur le
              demande.
            </p>
          ) : null}
          {error ? (
            <p className="ex-micro ex-range-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
