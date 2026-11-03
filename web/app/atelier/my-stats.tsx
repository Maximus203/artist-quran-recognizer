"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { ApiSession, SessionPage } from "@/lib/api-types";
import {
  formatBytesFr,
  formatClockLength,
  formatDurationFr,
  formatSecondsFr,
} from "@/lib/format";
import { engineLabel, isVideoSession } from "@/lib/session-list";
import { storageState } from "@/lib/storage-meter";
import { Icon } from "./icons";

export type MyStatsData = {
  tests: number;
  failures: number;
  audio_hours: number;
  processing_hours: number;
  rtf_mean: number | null;
  by_engine: { engine: string; tests: number }[];
  sessions: { total: number; private: number; audio_hours: number };
  storage: {
    used_bytes: number;
    disk_bytes: number;
    limit_bytes: number | null;
    remaining_bytes: number | null;
  };
};

/** Mes statistiques et mon stockage (page Compte et Performance → Moi) : uniquement MES chiffres. */
export function MyStats() {
  const [stats, setStats] = useState<MyStatsData | null>(null);
  const [biggest, setBiggest] = useState<ApiSession[]>([]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    Promise.all([
      api<MyStatsData>("/api/me/stats"),
      api<SessionPage>("/api/sessions?scope=mine&sort=size&limit=4"),
    ])
      .then(([mine, page]) => {
        if (cancelled) return;
        setStats(mine);
        setBiggest(page.items);
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Statistiques indisponibles",
          );
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error)
    return (
      <div className="card state-box state-box--error" role="alert">
        <Icon name="alert" className="big" />
        <h2>Tes statistiques ne se sont pas chargées</h2>
        <p>{error}</p>
        <div className="acts">
          <button
            className="btn btn--secondary"
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Réessayer
          </button>
        </div>
      </div>
    );
  if (!stats)
    return (
      <p className="muted" role="status" data-testid="stats-loading">
        Chargement de tes chiffres…
      </p>
    );

  const space = storageState({
    used_bytes: stats.storage.used_bytes,
    limit_bytes: stats.storage.limit_bytes,
  });
  const limit = stats.storage.limit_bytes;
  const topEngine = Math.max(1, ...stats.by_engine.map((e) => e.tests));
  return (
    <div style={{ display: "grid", gap: "var(--sp-5)" }} data-testid="my-stats">
      <div className="tiles tiles--3" aria-label="Mes chiffres">
        <div className="card tile" data-testid="stat-tests">
          <p className="eyebrow">Tests</p>
          <p className="v">{stats.tests}</p>
          <p className="s">
            {stats.tests === 0
              ? "aucune analyse terminée"
              : `sessions analysées${stats.failures ? `, dont ${stats.failures} en échec` : ""}`}
          </p>
        </div>
        <div className="card tile" data-testid="stat-audio">
          <p className="eyebrow">Audio analysé</p>
          <p className="v">
            {stats.tests === 0
              ? "—"
              : formatDurationFr(Math.round(stats.audio_hours * 3600))}
          </p>
          <p className="s">sur {stats.sessions.total} sessions conservées</p>
        </div>
        <div className="card tile" data-testid="stat-speed">
          <p className="eyebrow">Vitesse moyenne</p>
          <p className="v">
            {stats.rtf_mean === null
              ? "—"
              : `×${formatSecondsFr(stats.rtf_mean)}`}
          </p>
          <p className="s">fois plus vite que l’audio</p>
        </div>
        <div className="card tile" data-testid="stat-space">
          <p className="eyebrow">Espace utilisé</p>
          <p className="v">{formatBytesFr(stats.storage.used_bytes)}</p>
          <p className="s">
            {limit
              ? `sur ${formatBytesFr(limit)} de quota`
              : "sans limite de quota"}
          </p>
        </div>
      </div>

      <div
        className="card meter-card"
        data-state={space.state}
        data-testid="meter-card"
      >
        <div className="meter-head">
          <div>
            <p className="eyebrow">Stockage</p>
            <p className="big">
              {formatBytesFr(stats.storage.used_bytes)}{" "}
              <small>
                {limit ? `sur ${formatBytesFr(limit)}` : "utilisés"}
              </small>
            </p>
          </div>
          <Link
            className="btn btn--secondary btn--sm"
            href="/sessions?portee=mine"
          >
            <Icon name="list" />
            Voir mes sessions
          </Link>
        </div>
        {limit ? (
          <div
            className="meter"
            role="meter"
            aria-label="Espace utilisé"
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={Math.min(stats.storage.used_bytes, limit)}
            aria-valuetext={`${formatBytesFr(stats.storage.used_bytes)} utilisés sur ${formatBytesFr(limit)}`}
          >
            <span
              className="m aud"
              style={{ "--w": `${space.percent}%` } as React.CSSProperties}
            />
            <span className="tick" aria-hidden="true" />
          </div>
        ) : null}
        <ul className="meter-legend" aria-label="Légende du stockage">
          <li>
            <span>
              <i className="sw s-recognized" aria-hidden="true" />
              Utilisé ·{" "}
              <b className="mono">{formatBytesFr(stats.storage.used_bytes)}</b>
            </span>
          </li>
          {stats.storage.remaining_bytes !== null ? (
            <li>
              <span className="muted">
                Libre ·{" "}
                <b className="mono">
                  {formatBytesFr(stats.storage.remaining_bytes)}
                </b>
              </span>
            </li>
          ) : null}
        </ul>
        {space.state !== "ok" ? (
          <div className="meter-alert" role="status" data-testid="meter-alert">
            <Icon name="alert" />
            <div>
              {space.state === "warn" ? (
                <>
                  <b>
                    Espace presque plein :{" "}
                    {formatBytesFr(stats.storage.used_bytes)} sur{" "}
                    {formatBytesFr(limit ?? 0)}.
                  </b>
                  <br />
                  <span>
                    À partir de {formatBytesFr(limit ?? 0)}, tu ne pourras plus
                    importer. Archive puis supprime les gros fichiers dont tu
                    n’as plus besoin.
                  </span>
                </>
              ) : (
                <>
                  <b>Quota atteint : les nouveaux imports sont bloqués.</b>
                  <br />
                  <span>
                    Supprime des sessions archivées pour libérer de la place, ou
                    demande à l’administrateur d’augmenter ton quota.
                  </span>
                </>
              )}
              <div className="btnrow">
                <Link
                  className="btn btn--secondary btn--sm"
                  href="/sessions?portee=mine&tri=size"
                >
                  Trier par taille
                </Link>
                <Link
                  className="btn btn--secondary btn--sm"
                  href="/sessions?portee=arch"
                >
                  Voir les archives
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <p className="hint">
            Les sessions archivées comptent aussi. Seule la suppression
            définitive libère de l’espace.
          </p>
        )}
      </div>

      <div className="grid2">
        <div className="card card-pad bigfiles" data-testid="biggest">
          <div className="sec-title">
            <h2>Ce qui prend le plus de place</h2>
          </div>
          {biggest.length === 0 ? (
            <p className="hint">Aucune session pour l’instant.</p>
          ) : (
            biggest.map((s) => (
              <div className="qrow" key={s.id}>
                <span className="nm">
                  {s.name}
                  <small>
                    {isVideoSession(s) ? "Vidéo" : "Audio"}
                    {s.audio_duration_s
                      ? ` · ${formatClockLength(s.audio_duration_s)}`
                      : ""}
                    {` · ${s.visibility === "private" ? "privé" : "global"}`}
                  </small>
                </span>
                <span className="sz">{formatBytesFr(s.size_bytes)}</span>
                <Link
                  className="btn btn--ghost btn--sm"
                  href={`/?session=${s.id}`}
                >
                  Voir
                </Link>
              </div>
            ))
          )}
        </div>
        <div className="card card-pad" data-testid="by-engine">
          <div className="sec-title">
            <h2>Mes analyses par moteur</h2>
          </div>
          {stats.by_engine.length === 0 ? (
            <p className="hint">Aucune analyse terminée.</p>
          ) : (
            <>
              <div className="bars">
                {stats.by_engine.map((e) => (
                  <div className="bar-row" key={e.engine}>
                    <span className="nm">
                      {engineLabel(e.engine)}
                      <small>
                        {e.tests} analyse{e.tests > 1 ? "s" : ""}
                      </small>
                    </span>
                    <span className="bar-track">
                      <i
                        style={
                          {
                            "--v": `${(e.tests / topEngine) * 100}%`,
                          } as React.CSSProperties
                        }
                      />
                    </span>
                    <span className="val">{e.tests}</span>
                  </div>
                ))}
              </div>
              <p className="axis-note">
                Nombre d’analyses terminées avec chaque moteur.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
