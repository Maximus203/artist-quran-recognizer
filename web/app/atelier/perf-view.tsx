"use client";
import { useEffect, useMemo, useState } from "react";
import {
  formatClockLength,
  formatDurationFr,
  formatEtaFr,
  formatSecondsFr,
} from "@/lib/format";
import {
  buildPerformance,
  splitDuration,
  type Period,
} from "@/lib/performance";
import type { SessionView, Stats } from "@/lib/session-view";
import { engineLabel } from "@/lib/session-list";
import { SessionGlyph } from "./icons";
import { usePageVisible } from "./hooks";

const PERIODS: { id: Period; label: string }[] = [
  { id: "7d", label: "7 jours" },
  { id: "30d", label: "30 jours" },
  { id: "all", label: "Tout" },
];

function Big({ parts }: { parts: { n: string; u: string }[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 ? " " : ""}
          {part.n}
          {part.u ? <small>{part.u}</small> : null}
        </span>
      ))}
    </>
  );
}

/** Le tableau de bord Performance : des durées réelles, mesurées ; aucun chiffre inventé. */
export function PerfView({ views }: { views: readonly SessionView[] }) {
  const [period, setPeriod] = useState<Period>("7d");
  const [stats, setStats] = useState<Stats | null>(null);
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const load = () =>
      fetch("/api/stats", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<Stats>) : null))
        .then((value) => !cancelled && value && setStats(value))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible]);
  const model = useMemo(
    () => buildPerformance(views, period, Date.now()),
    [views, period],
  );
  const queue = stats?.queue;
  const running = queue?.running ?? [];
  const waiting = queue?.waiting ?? [];
  const etas = [...running, ...waiting].map((q) => q.eta_s);
  const queueEnd =
    etas.length > 0 && etas.every((e): e is number => typeof e === "number")
      ? Math.max(...etas)
      : null;
  const quality = stats?.engines.find((e) => e.estimate)?.estimate;
  const empty = model.analyses === 0;
  return (
    <div className="stack" data-testid="perf-view">
      <header className="page-title">
        <div>
          <h1>Performance</h1>
          <p>
            Combien de temps prend une analyse, et à quelle vitesse. Sert à
            estimer la fin d’une file avant de partir.
          </p>
        </div>
        <div
          className="seg-filters"
          style={{ margin: 0 }}
          role="group"
          aria-label="Période"
        >
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="chip"
              data-testid={`period-${p.id}`}
              aria-pressed={period === p.id}
              onClick={() => setPeriod(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <div className="tiles">
        <div className="card tile" data-testid="tile-duration">
          <span className="eyebrow">Durée moyenne</span>
          <div className="v">
            {model.meanDurationS === null ? (
              "—"
            ) : (
              <Big parts={splitDuration(model.meanDurationS)} />
            )}
          </div>
          <div className="s">
            {empty
              ? "Aucune analyse terminée"
              : `par analyse · ${model.analyses} terminées`}
          </div>
        </div>
        <div className="card tile" data-testid="tile-speed">
          <span className="eyebrow">Vitesse médiane</span>
          <div className="v">
            {model.medianFactor === null
              ? "—"
              : `×${formatSecondsFr(model.medianFactor)}`}
          </div>
          <div className="s">
            {model.hourOfAudioS === null
              ? "temps réel"
              : `temps réel · 1 h d’audio ≈ ${Math.max(1, Math.round(model.hourOfAudioS / 60))} min`}
          </div>
        </div>
        <div className="card tile" data-testid="tile-audio">
          <span className="eyebrow">Audio traité</span>
          <div className="v">
            {empty ? (
              "—"
            ) : (
              <Big parts={splitDuration(Math.max(60, model.audioTotalS))} />
            )}
          </div>
          <div className="s">
            {model.videoAudioS > 0
              ? `dont ${formatDurationFr(model.videoAudioS)} de vidéo`
              : empty
                ? "rien pour l’instant"
                : "aucune vidéo"}
          </div>
        </div>
        <div className="card tile" data-testid="tile-queue">
          <span className="eyebrow">File d’attente</span>
          <div className="v">
            {running.length}
            {waiting.length > 0 ? (
              <small>+ {waiting.length} en attente</small>
            ) : null}
          </div>
          <div className="s">
            {queueEnd !== null
              ? `fin estimée dans ${formatEtaFr(queueEnd)}`
              : running.length + waiting.length > 0
                ? "fin non estimable"
                : "aucune analyse en cours"}
          </div>
        </div>
      </div>

      <div className="grid2">
        <section className="card card-pad" data-testid="engine-bars">
          <div className="sec-title">
            <h2>Vitesse par moteur</h2>
            <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              médiane · × temps réel
            </span>
          </div>
          {model.engines.length === 0 ? (
            <p className="hint">Aucune analyse terminée sur cette période.</p>
          ) : (
            <>
              <div className="bars" role="list">
                {model.engines.map((e) => (
                  <div className="bar-row" role="listitem" key={e.engine}>
                    <div className="nm">
                      {e.label}
                      <small>
                        {e.count} analyse{e.count > 1 ? "s" : ""}
                      </small>
                    </div>
                    <div className="bar-track">
                      <i
                        style={
                          {
                            "--v": `${Math.max(2, e.ratio * 100)}%`,
                          } as React.CSSProperties
                        }
                      />
                    </div>
                    <div className="val">
                      ×{formatSecondsFr(e.medianFactor)}
                    </div>
                  </div>
                ))}
              </div>
              <p className="axis-note">
                Plus la barre est longue, plus l’analyse est rapide. La couleur
                ne porte aucun sens : chaque barre est nommée et chiffrée.
              </p>
              <details className="diag" style={{ padding: "var(--sp-3) 0 0" }}>
                <summary>Voir en tableau</summary>
                <div
                  className="scroll-x"
                  tabIndex={0}
                  role="region"
                  aria-label="Vitesse par moteur, en tableau"
                >
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Moteur</th>
                        <th className="num">Analyses</th>
                        <th className="num">× temps réel</th>
                        <th className="num">Durée moy.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {model.engines.map((e) => (
                        <tr key={e.engine}>
                          <td>{e.label}</td>
                          <td className="num">{e.count}</td>
                          <td className="num">
                            {formatSecondsFr(e.medianFactor)}
                          </td>
                          <td className="num">
                            {formatDurationFr(e.meanDurationS)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </section>

        <section className="card card-pad" data-testid="queue-card">
          <div className="sec-title">
            <h2>File en cours</h2>
          </div>
          {running.length + waiting.length === 0 ? (
            <p className="hint">
              Rien en cours. Les analyses lancées apparaîtront ici.
            </p>
          ) : (
            <>
              {running.map((q) => (
                <div className="qrow" key={q.id}>
                  <span
                    className="sess-glyph"
                    style={{ color: "var(--accent)" }}
                  >
                    <SessionGlyph state="running" rank={null} progress={null} />
                  </span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{q.name}</div>
                    <div className="hint">
                      {engineLabel(q.engine)}
                      {q.elapsed_s !== null
                        ? ` · écoulé ${formatDurationFr(q.elapsed_s)}`
                        : ""}
                    </div>
                  </div>
                  <div
                    className="mono"
                    style={{ color: "var(--accent)", fontWeight: 600 }}
                  >
                    {q.eta_s === null ? "—" : formatEtaFr(q.eta_s)}
                  </div>
                </div>
              ))}
              {waiting.map((q) => (
                <div className="qrow" key={q.id}>
                  <span className="sess-glyph">
                    <SessionGlyph
                      state="queued"
                      rank={q.queue_position}
                      progress={null}
                    />
                  </span>
                  <div>
                    <div style={{ fontWeight: 600 }}>{q.name}</div>
                    <div className="hint">
                      {engineLabel(q.engine)} · n° {q.queue_position} dans la
                      file
                    </div>
                  </div>
                  <div className="mono muted">
                    {q.eta_s === null ? "—" : formatEtaFr(q.eta_s)}
                  </div>
                </div>
              ))}
            </>
          )}
          <p className="hint" style={{ marginTop: "var(--sp-3)" }}>
            Estimation = durée de l’audio ramenée à la vitesse observée du
            moteur, moins le temps déjà écoulé.
            {quality && quality.loo_median_rel_error !== null
              ? ` Erreur médiane de l’estimation sur les analyses passées : ${Math.round(quality.loo_median_rel_error * 100)} %.`
              : ""}
          </p>
        </section>
      </div>

      <section className="card card-pad" data-testid="recent-table">
        <div className="sec-title">
          <h2>Dernières analyses</h2>
        </div>
        {model.recent.length === 0 ? (
          <p className="hint">Aucune analyse terminée sur cette période.</p>
        ) : (
          <div
            className="scroll-x"
            tabIndex={0}
            role="region"
            aria-label="Dernières analyses, en tableau"
          >
            <table className="table">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Type</th>
                  <th className="num">Audio</th>
                  <th className="num">Analyse</th>
                  <th className="num">× temps réel</th>
                </tr>
              </thead>
              <tbody>
                {model.recent.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.kind === "video" ? "Vidéo" : "Audio"}</td>
                    <td className="num">{formatClockLength(r.audioS)}</td>
                    <td className="num">{formatClockLength(r.processingS)}</td>
                    <td className="num">{formatSecondsFr(r.factor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
