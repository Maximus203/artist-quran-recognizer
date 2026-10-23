"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import type { ApiSession, SessionPage } from "@/lib/api-types";
import {
  formatBytesFr,
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
import type { Stats } from "@/lib/session-view";
import type { VisibleStats } from "@/lib/session-service";
import { engineLabel } from "@/lib/session-list";
import { storageState } from "@/lib/storage-meter";
import { SessionGlyph } from "./icons";
import { usePageVisible } from "./hooks";
import { MyStats } from "./my-stats";

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

/** Au plus 5 pages de 100 : de quoi calculer les moyennes sans charger toute la base. */
const PERF_PAGES = 5;
const PERIOD_DAYS: Record<Period, number | null> = {
  "7d": 7,
  "30d": 30,
  all: null,
};

/**
 * Les analyses terminées que l'utilisateur voit (les globales et les siennes), sur la période :
 * c'est la matière des moyennes. Le serveur filtre et pagine, on ne charge jamais tout.
 */
function useDoneSessions(period: Period) {
  const [sessions, setSessions] = useState<ApiSession[]>([]);
  const [loaded, setLoaded] = useState(false);
  const visible = usePageVisible();
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const days = PERIOD_DAYS[period];
    const load = async () => {
      const found: ApiSession[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < PERF_PAGES; page += 1) {
        const params = new URLSearchParams({
          scope: "all",
          state: "done",
          sort: "recent",
          limit: "100",
        });
        if (days !== null)
          params.set(
            "from",
            new Date(Date.now() - days * 86_400_000).toISOString(),
          );
        if (cursor) params.set("cursor", cursor);
        const result: SessionPage = await api<SessionPage>(
          `/api/sessions?${params}`,
        );
        found.push(...result.items);
        cursor = result.next_cursor;
        if (!cursor) break;
      }
      if (!cancelled) {
        setSessions(found);
        setLoaded(true);
      }
    };
    const run = () => void load().catch(() => !cancelled && setLoaded(true));
    run();
    const timer = setInterval(run, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [period, visible]);
  return { sessions, loaded };
}

/** Stockage du serveur : même barre que celle du compte, sans détail par compte. */
function ServerStorage({ stats }: { stats: VisibleStats | null }) {
  if (!stats) return null;
  const { disk, totals } = stats;
  const total = disk.total_bytes;
  const state =
    total && total > 0
      ? storageState({ used_bytes: disk.used_bytes, limit_bytes: total })
      : null;
  return (
    <section
      className="card card-pad storage-line"
      data-testid="server-storage"
    >
      <div className="sec-title">
        <h2>Stockage du serveur</h2>
      </div>
      <p>
        <b className="mono">{formatBytesFr(disk.used_bytes)}</b>
        {total ? ` sur ${formatBytesFr(total)}` : ""} · {totals.sessions}{" "}
        fichier{totals.sessions > 1 ? "s" : ""}
      </p>
      {state ? (
        <div className="meter-card" data-state="ok" style={{ padding: 0 }}>
          <div
            className="meter"
            role="meter"
            aria-label="Espace occupé sur le disque du serveur"
            aria-valuemin={0}
            aria-valuemax={total ?? 0}
            aria-valuenow={Math.min(disk.used_bytes, total ?? 0)}
            aria-valuetext={`${formatBytesFr(disk.used_bytes)} occupés sur ${formatBytesFr(total ?? 0)}`}
          >
            <span
              className="m aud"
              style={
                {
                  "--w": `${Math.max(1, state.percent)}%`,
                } as React.CSSProperties
              }
            />
          </div>
        </div>
      ) : null}
      {disk.free_bytes !== null ? (
        <p className="hint">
          Libre sur le disque : {formatBytesFr(disk.free_bytes)}.
        </p>
      ) : null}
    </section>
  );
}

/** Le tableau de bord Performance : des durées réelles, mesurées ; aucun chiffre inventé. */
export function PerfView({ initialMine = false }: { initialMine?: boolean }) {
  const [mine, setMine] = useState(initialMine);
  const [period, setPeriod] = useState<Period>("7d");
  const [stats, setStats] = useState<VisibleStats | null>(null);
  const visible = usePageVisible();
  const { sessions, loaded } = useDoneSessions(period);
  useEffect(() => {
    if (!visible || mine) return;
    let cancelled = false;
    const load = () =>
      api<VisibleStats>("/api/stats")
        .then((value) => !cancelled && setStats(value))
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [visible, mine]);
  const model = useMemo(
    () => buildPerformance(sessions, period, Date.now()),
    [sessions, period],
  );
  const queue = (stats as Stats | null)?.queue;
  const running = queue?.running ?? [];
  const waiting = queue?.waiting ?? [];
  const etas = [...running, ...waiting].map((q) => q.eta_s);
  const queueEnd =
    etas.length > 0 && etas.every((e): e is number => typeof e === "number")
      ? Math.max(...etas)
      : null;
  const quality = stats?.engines.find((e) => e.estimate)?.estimate;
  const switcher = (
    <div className="seg-ctl" role="group" aria-label="Quelles analyses ?">
      <button
        type="button"
        data-testid="perf-global"
        aria-pressed={!mine}
        onClick={() => {
          setMine(false);
          history.replaceState(null, "", "/performance");
        }}
      >
        Tous les testeurs
      </button>
      <button
        type="button"
        data-testid="perf-mine"
        aria-pressed={mine}
        onClick={() => {
          setMine(true);
          history.replaceState(null, "", "/performance?vue=moi");
        }}
      >
        Moi
      </button>
    </div>
  );
  if (mine)
    return (
      <div className="page" data-testid="perf-view">
        <div className="pg-title">
          <div>
            <h1>Performance</h1>
            <p>Mes analyses et mon espace.</p>
          </div>
          {switcher}
        </div>
        <MyStats />
      </div>
    );
  const empty = model.analyses === 0;
  return (
    <div className="page page--grid" data-testid="perf-view">
      <header className="pg-title">
        <div>
          <h1>Performance</h1>
          <p>
            Combien de temps prend une analyse, et à quelle vitesse. Sert à
            estimer la fin d’une file avant de partir.
          </p>
        </div>
        {switcher}
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

      <ServerStorage stats={stats} />

      <section className="card card-pad" data-testid="recent-table">
        <div className="sec-title">
          <h2>Dernières analyses</h2>
        </div>
        <p className="hint" style={{ marginBottom: "var(--sp-3)" }}>
          Seules les sessions globales sont nommées ici ; les privées d’un autre
          testeur ne sont ni visibles ni comptées.
        </p>
        {!loaded ? (
          <p className="hint" role="status">
            Chargement des analyses…
          </p>
        ) : model.recent.length === 0 ? (
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
                  <th>Testeur</th>
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
                    <td>{r.owner ?? "—"}</td>
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
