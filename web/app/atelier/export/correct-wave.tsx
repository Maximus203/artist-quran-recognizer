"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import type { Store } from "@/lib/mini-store";
import { clock } from "@/lib/export-text";
import type { ReadinessItem } from "@/lib/export-types";
import { barHeights, peakNorm } from "@/lib/waveform";
import { useStoreValue } from "../hooks";
import type { PlayerState } from "../use-player";

type Peaks = { duration: number; peaks: number[] };
const cache = new Map<string, Promise<Peaks | null>>();

/** Les crêtes de la copie d'écoute (une seule requête par session et par page, jamais l'audio décodé). */
function usePeaks(sessionId: string): Peaks | null {
  const [peaks, setPeaks] = useState<Peaks | null>(null);
  useEffect(() => {
    let alive = true;
    let pending = cache.get(sessionId);
    if (!pending) {
      pending = api<Peaks>(`/api/sessions/${sessionId}/peaks`).catch(
        () => null,
      );
      cache.set(sessionId, pending);
    }
    void pending.then((value) => alive && setPeaks(value));
    return () => {
      alive = false;
    };
  }, [sessionId]);
  return peaks;
}

const BARS = 240;
const SEGMENT_CLASS: Record<string, string> = {
  uncertain: "",
  inferred: "",
  cut: "ex-wv-seg--rec",
  approx: "ex-wv-seg--rec",
  report: "ex-wv-seg--abs",
};

/** Fenêtre d'affichage autour du passage : de quoi l'entendre dans son contexte, sans zoom à régler. */
export function windowOf(
  t: readonly [number, number],
  duration: number,
): [number, number] {
  const margin = Math.min(30, Math.max(8, (t[1] - t[0]) * 0.5));
  const start = Math.max(0, t[0] - margin);
  const end = Math.min(duration > 0 ? duration : Infinity, t[1] + margin);
  return [start, Math.max(end, start + 1)];
}

const pct = (value: number, window: readonly [number, number]) =>
  ((value - window[0]) / (window[1] - window[0])) * 100;

function Playhead({
  store,
  window,
}: {
  store: Store<PlayerState>;
  window: readonly [number, number];
}) {
  const time = useStoreValue(store, (s) => s.time);
  const inside = time >= window[0] && time <= window[1];
  return (
    <i
      className="ex-wv-play"
      aria-hidden="true"
      style={
        {
          "--ph": `${pct(time, window)}%`,
          display: inside ? undefined : "none",
        } as React.CSSProperties
      }
    />
  );
}

/**
 * L'onde à trois lignes de la correction : Onde (±), Moteur (ce que le moteur a dit, figé), Décision (les
 * losanges d'encre de la correction humaine). La tête de lecture traverse les trois lignes au même x.
 */
export function CorrectWave({
  sessionId,
  item,
  around,
  decision,
  store,
  onSeek,
}: {
  sessionId: string;
  item: ReadinessItem;
  /** Les autres passages proches : leurs segments sont dessinés en repère. */
  around: readonly ReadinessItem[];
  /** Début et fin de la décision en cours (nul tant qu'aucun choix n'est fait). */
  decision: [number, number] | null;
  store: Store<PlayerState>;
  onSeek: (time: number) => void;
}) {
  const peaks = usePeaks(sessionId);
  const window = useMemo(
    () => windowOf(item.t, peaks?.duration ?? 0),
    [item.t, peaks?.duration],
  );
  const path = useMemo(() => {
    if (!peaks) return "";
    const norm = peakNorm(peaks.peaks);
    const heights = barHeights(
      peaks.peaks,
      peaks.duration,
      window[0],
      window[1],
      BARS,
      norm,
    );
    let d = "";
    heights.forEach((h, i) => {
      const x = (i / BARS) * 600;
      const amp = Math.max(0.6, h * 26);
      d += `M${x.toFixed(1)} ${(28 - amp).toFixed(1)}V${(28 + amp).toFixed(1)}`;
    });
    return d;
  }, [peaks, window]);
  const ticks = [0, 1, 2, 3].map(
    (n) => window[0] + ((window[1] - window[0]) * n) / 3,
  );
  const left = (t: number) => `${Math.max(0, pct(t, window))}%`;
  const width = (a: number, b: number) =>
    `${Math.max(0.6, pct(Math.min(b, window[1]), window) - Math.max(0, pct(a, window)))}%`;
  return (
    <div
      className="ex-wv"
      role="img"
      aria-label={`Forme d’onde de ${clock(window[0])} à ${clock(window[1])}. Le moteur a placé ce passage de ${clock(item.t[0])} à ${clock(item.t[1])}.${decision ? ` Ta décision va de ${clock(decision[0])} à ${clock(decision[1])}.` : " Aucune décision pour l’instant."}`}
      data-testid="wave"
    >
      <div className="ex-wv-row">
        <span className="ex-wv-n">Onde</span>
        <div
          className="ex-wv-track"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            onSeek(
              window[0] +
                ((event.clientX - box.left) / box.width) *
                  (window[1] - window[0]),
            );
          }}
        >
          <svg
            viewBox="0 0 600 56"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <path d={path} />
          </svg>
          <Playhead store={store} window={window} />
        </div>
      </div>
      <div className="ex-wv-row">
        <span className="ex-wv-n">Moteur</span>
        <div className="ex-wv-track lane">
          {around
            .filter(
              (o) =>
                o.key !== item.key && o.t[1] > window[0] && o.t[0] < window[1],
            )
            .map((o) => (
              <span
                key={o.key}
                className={`ex-wv-seg ${SEGMENT_CLASS[o.type]}`}
                style={{
                  left: left(o.t[0]),
                  width: width(o.t[0], o.t[1]),
                  opacity: 0.55,
                }}
                title={o.ref ?? undefined}
              />
            ))}
          <span
            className={`ex-wv-seg ${SEGMENT_CLASS[item.type]}`}
            style={{
              left: left(item.t[0]),
              width: width(item.t[0], item.t[1]),
            }}
            title="Ce que le moteur a dit (figé)"
          />
        </div>
      </div>
      <div className="ex-wv-row">
        <span className="ex-wv-n">Décision</span>
        <div className="ex-wv-track lane">
          {decision ? (
            <span
              className="ex-wv-hum"
              data-testid="wave-decision"
              style={{
                left: left(decision[0]),
                width: width(decision[0], decision[1]),
              }}
            >
              <b className="a" />
              <b className="b" />
            </span>
          ) : (
            <span className="ex-wv-empty-lane">Aucune décision</span>
          )}
        </div>
      </div>
      <div className="ex-wv-axis" aria-hidden="true">
        <span />
        <div>
          {ticks.map((t) => (
            <span key={t}>{clock(t).slice(0, 5)}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
