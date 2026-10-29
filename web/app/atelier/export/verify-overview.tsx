"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { ListeningPeaks } from "@/lib/listening";
import type { Interval, Recognition } from "@/lib/recognition";

/**
 * Frise d'ensemble de l'onglet Vérifier, en lecture seule : l'onde de tout l'audio, les passages
 * reconnus en trait, et un losange sur chaque passage ambigu (ambre) ou déduit (lapis). Elle dit
 * OÙ sont les passages à regarder ; les cartes, dessous, disent QUOI trancher.
 */
export function VerifyOverview({ sessionId }: { sessionId: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [data, setData] = useState<{
    peaks: ListeningPeaks;
    intervals: readonly Interval[];
  } | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ result: Recognition | null }>(`/api/sessions/${sessionId}`),
      api<ListeningPeaks>(`/api/sessions/${sessionId}/peaks`),
    ])
      .then(([detail, peaks]) => {
        if (!cancelled)
          setData({ peaks, intervals: detail.result?.intervals ?? [] });
      })
      .catch(() => undefined); // frise facultative : les cartes suffisent
    return () => {
      cancelled = true;
    };
  }, [sessionId]);
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [data]);
  useEffect(() => {
    const node = canvas.current;
    const p = probe.current;
    if (!node || !p || !data || width === 0) return;
    const h = 44;
    const dpr = window.devicePixelRatio || 1;
    node.width = Math.round(width * dpr);
    node.height = Math.round(h * dpr);
    const g = node.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const color = (name: string) => {
      p.style.color = `var(${name})`;
      return getComputedStyle(p).color;
    };
    const wave = color("--wave");
    const accent = color("--accent");
    const warn = color("--warn-edge");
    const slate = color("--slate-edge");
    const { peaks, intervals } = data;
    const D = peaks.duration || 1;
    const per = peaks.peaks.length / width;
    g.fillStyle = wave;
    for (let px = 0; px < width; px++) {
      let m = 0;
      for (let k = Math.floor(px * per); k < Math.floor((px + 1) * per); k++)
        if (peaks.peaks[k] > m) m = peaks.peaks[k];
      g.fillRect(px, 22 - m * 12, 1, m * 24 + 0.5);
    }
    for (const item of intervals) {
      if (!item.t) continue;
      const x = (item.t[0] / D) * width;
      const w = Math.max(1, ((item.t[1] - item.t[0]) / D) * width);
      if (item.kind !== "verse") {
        g.fillStyle = slate;
        g.globalAlpha = 0.4;
        g.fillRect(x, 38, w, 4);
        g.globalAlpha = 1;
        continue;
      }
      const status = item.status ?? "recognized";
      if (status === "recognized") {
        g.fillStyle = accent;
        g.globalAlpha = 0.55;
        g.fillRect(x, 38, w, 4);
        g.globalAlpha = 1;
      } else {
        g.fillStyle = status === "uncertain" ? warn : accent;
        g.beginPath();
        g.moveTo(x, 2);
        g.lineTo(x + 6, 10);
        g.lineTo(x, 18);
        g.lineTo(x - 6, 10);
        g.fill();
      }
    }
  }, [data, width]);
  if (!data) return null;
  const ambiguous = data.intervals.filter(
    (i) => i.kind === "verse" && i.status === "uncertain",
  ).length;
  const inferred = data.intervals.filter(
    (i) => i.kind === "verse" && i.status === "inferred",
  ).length;
  return (
    <figure className="xr-overview" data-testid="verify-overview">
      <span ref={probe} hidden />
      <canvas
        ref={canvas}
        role="img"
        aria-label={`Vue d’ensemble de l’audio : ${ambiguous} passage(s) ambigu(s) marqués d’un losange ambre, ${inferred} passage(s) déduit(s) d’un losange lapis.`}
      />
      <figcaption className="xr-legend">
        <span>
          <i className="lg-rec" />
          Reconnu
        </span>
        <span>
          <i className="lg-unc" />
          Ambigu ({ambiguous})
        </span>
        <span>
          <i className="lg-inf" />
          Déduit ({inferred})
        </span>
      </figcaption>
    </figure>
  );
}
