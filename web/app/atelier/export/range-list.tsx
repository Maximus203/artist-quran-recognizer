"use client";
import { useState } from "react";
import { EXPORT_VIDEO_CONFIG } from "@/lib/export-video-config";
import { formatClock, setEdge, spokenTime } from "@/lib/export-timeline";
import { rangeFacts, type PlanRange } from "@/lib/export-video-plan";
import {
  MAX_RANGE_NAME,
  MIN_RANGE_SECONDS,
  parseTimeInput,
} from "@/lib/export-video-ranges";
import type { SuggestTiming } from "@/lib/export-video-suggest";
import { formatDurationFr } from "@/lib/format";
import { XIcon } from "./export-icons";
import { Stepper, Switch } from "./export-ui";

/**
 * Liste des plages (« signets ») : une vidéo chacune, dans l'ordre. Nom éditable (nom du fichier),
 * temps, durée, passages, « à vérifier », chevauchement et voix coupée ; saisie précise au clavier
 * en secours, monter / descendre / retirer. Et le réglage du souffle gardé autour de la voix.
 */
const STEP = EXPORT_VIDEO_CONFIG.keyboard.step;
const PAD = EXPORT_VIDEO_CONFIG.padding;
const comma = (v: number) => v.toFixed(1).replace(".", ",");

function FineTimes({
  range,
  index,
  duration,
  onChange,
}: {
  range: PlanRange;
  index: number;
  duration: number;
  onChange: (next: { start: number; end: number }) => void;
}) {
  const [error, setError] = useState<{
    edge: "start" | "end";
    text: string;
  } | null>(null);
  const commit = (edge: "start" | "end", text: string) => {
    const value = parseTimeInput(text.replace(/\s*s$/, ""));
    if (value === null)
      return setError({
        edge,
        text: "Écris le temps comme 3:12,4 (minutes:secondes,dixièmes).",
      });
    if (value > duration)
      return setError({
        edge,
        text: `L’audio s’arrête à ${formatClock(duration)}.`,
      });
    if (
      (edge === "start" && value > range.end - MIN_RANGE_SECONDS) ||
      (edge === "end" && value < range.start + MIN_RANGE_SECONDS)
    )
      return setError({
        edge,
        text: `La fin doit venir au moins ${comma(MIN_RANGE_SECONDS)} s après le début.`,
      });
    setError(null);
    if (Math.abs(value - range[edge]) > 1e-6)
      onChange(setEdge(range, edge, value, duration));
  };
  return (
    <div className="pfine">
      {(["start", "end"] as const).map((edge) => (
        <Stepper
          key={edge}
          label={`${edge === "start" ? "Début" : "Fin"} (min:s,dixièmes)`}
          value={formatClock(range[edge])}
          invalid={error?.edge === edge}
          testId={`range-${edge}-${index + 1}`}
          decLabel={`${edge === "start" ? "Début" : "Fin"} moins ${comma(STEP)} s`}
          incLabel={`${edge === "start" ? "Début" : "Fin"} plus ${comma(STEP)} s`}
          onStep={(dir) => {
            setError(null);
            onChange(setEdge(range, edge, range[edge] + dir * STEP, duration));
          }}
          onCommit={(text) => commit(edge, text)}
        />
      ))}
      {error ? (
        <span className="perr" role="alert">
          {error.text}
        </span>
      ) : null}
    </div>
  );
}

export function RangeList({
  ranges,
  selectedId,
  intervals,
  duration,
  onSelect,
  onChange,
  onRename,
  onUp,
  onDown,
  onRemove,
}: {
  ranges: readonly PlanRange[];
  selectedId: number | null;
  intervals: readonly SuggestTiming[];
  duration: number;
  onSelect: (id: number) => void;
  onChange: (id: number, next: { start: number; end: number }) => void;
  onRename: (id: number, name: string) => void;
  onUp: (id: number) => void;
  onDown: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  const [fine, setFine] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const visible = EXPORT_VIDEO_CONFIG.timeline.visibleRanges;
  const shown = all ? ranges : ranges.slice(0, visible);
  return (
    <ol
      className="xr-plist"
      aria-label="Plages à exporter, une vidéo chacune"
      data-testid="range-list"
    >
      {shown.map((range, index) => {
        const facts = rangeFacts(range, intervals, ranges);
        const n = index + 1;
        return (
          <li
            key={range.id}
            className="xr-pitem"
            data-selected={range.id === selectedId}
            data-testid={`range-item-${n}`}
          >
            <div className="pitem-head">
              <button
                type="button"
                className="pnum"
                aria-label={`Choisir la plage ${n}`}
                onClick={() => onSelect(range.id)}
              >
                {n}
              </button>
              <div className="pmain">
                <input
                  className="pname"
                  key={`${range.id}-${range.name}`}
                  defaultValue={range.name}
                  placeholder={`Plage ${n}`}
                  maxLength={MAX_RANGE_NAME}
                  aria-label={`Nom de la plage ${n}, utilisé dans le nom du fichier`}
                  data-testid={`range-name-${n}`}
                  onFocus={() => onSelect(range.id)}
                  onBlur={(e) => {
                    const value = e.currentTarget.value.trim();
                    if (value !== range.name) onRename(range.id, value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
                <span className="pmeta">
                  <span className="mono">
                    {formatClock(range.start)} → {formatClock(range.end)}
                  </span>
                  <span>{formatDurationFr(range.end - range.start)}</span>
                  <span>
                    {facts.verses
                      ? `${facts.verses} passage${facts.verses > 1 ? "s" : ""}`
                      : "aucun passage"}
                    {facts.toCheck ? (
                      <span className="warn">
                        {" "}
                        · {facts.toCheck} à vérifier
                      </span>
                    ) : null}
                  </span>
                  {facts.overlapsWith ? (
                    <span className="warn">
                      chevauche la plage {facts.overlapsWith}
                    </span>
                  ) : null}
                  {facts.cutsVoice ? (
                    <span className="danger" data-testid={`range-cut-${n}`}>
                      coupe une voix
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="pact">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-expanded={fine === range.id}
                  aria-label={`Saisir les temps de la plage ${n}`}
                  data-testid={`range-fine-${n}`}
                  onClick={() => {
                    onSelect(range.id);
                    setFine((v) => (v === range.id ? null : range.id));
                  }}
                >
                  <XIcon name="pen" />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-label={`Monter la plage ${n}`}
                  disabled={index === 0}
                  data-testid={`range-up-${n}`}
                  onClick={() => onUp(range.id)}
                >
                  <XIcon name="up" />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-label={`Descendre la plage ${n}`}
                  disabled={index === ranges.length - 1}
                  data-testid={`range-down-${n}`}
                  onClick={() => onDown(range.id)}
                >
                  <XIcon name="down" />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  aria-label={`Retirer la plage ${n}`}
                  data-testid={`range-remove-${n}`}
                  onClick={() => onRemove(range.id)}
                >
                  <XIcon name="trash" />
                </button>
              </div>
            </div>
            {fine === range.id ? (
              <FineTimes
                range={range}
                index={index}
                duration={duration}
                onChange={(next) => onChange(range.id, next)}
              />
            ) : null}
          </li>
        );
      })}
      {ranges.length > visible && !all ? (
        <li>
          <button
            type="button"
            className="btn btn--ghost btn--block"
            data-testid="range-more"
            onClick={() => setAll(true)}
          >
            Voir les {ranges.length - visible} autres plages
          </button>
        </li>
      ) : null}
    </ol>
  );
}

/** « Ne jamais couper une voix » : souffle avant / après et aimant au silence. */
export function BreathSettings({
  before,
  after,
  snap,
  onChange,
}: {
  before: number;
  after: number;
  snap: boolean;
  onChange: (next: { before?: number; after?: number; snap?: boolean }) => void;
}) {
  const bump = (value: number, dir: -1 | 1) =>
    Math.min(
      PAD.max,
      Math.max(PAD.min, Math.round((value + dir * PAD.step) * 10) / 10),
    );
  const read = (text: string): number | null => {
    const v = Number(text.replace(/\s*s$/, "").replace(",", ".").trim());
    return Number.isFinite(v) ? Math.min(PAD.max, Math.max(PAD.min, v)) : null;
  };
  return (
    <div className="xr-breathbox" data-testid="breath">
      <p>
        <b>Ne jamais couper une voix.</b> Chaque plage commence un peu avant la
        récitation et finit un peu après ; la zone hachurée montre ce souffle
        gardé. L’aimant cale les bords sur le silence le plus proche, sans
        jamais entrer dans la voix voisine.
      </p>
      <div className="xr-two">
        <Stepper
          label="Avant la voix"
          value={`${comma(before)} s`}
          testId="breath-before"
          decLabel={`Souffle avant moins ${comma(PAD.step)} s`}
          incLabel={`Souffle avant plus ${comma(PAD.step)} s`}
          onStep={(dir) => onChange({ before: bump(before, dir) })}
          onCommit={(text) => {
            const v = read(text);
            if (v !== null && v !== before) onChange({ before: v });
          }}
        />
        <Stepper
          label="Après la voix"
          value={`${comma(after)} s`}
          testId="breath-after"
          decLabel={`Souffle après moins ${comma(PAD.step)} s`}
          incLabel={`Souffle après plus ${comma(PAD.step)} s`}
          onStep={(dir) => onChange({ after: bump(after, dir) })}
          onCommit={(text) => {
            const v = read(text);
            if (v !== null && v !== after) onChange({ after: v });
          }}
        />
      </div>
      <Switch
        checked={snap}
        testId="breath-snap"
        onChange={(value) => onChange({ snap: value })}
        label="Aimanter au silence"
        hint="Les bords des plages proposées se calent sur un silence proche."
      />
    </div>
  );
}

export { spokenTime };
