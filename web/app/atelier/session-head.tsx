"use client";
import {
  formatClockLength,
  formatDurationFr,
  formatRealtimeFactor,
} from "@/lib/format";
import type { Recognition } from "@/lib/recognition";
import { buildRow, engineLabel, isVideoSession } from "@/lib/session-list";
import type { SessionView } from "@/lib/session-view";
import { Icon } from "./icons";

type Props = {
  view: SessionView;
  result: Recognition | null;
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
};

/** Titre de la session ouverte : ce que c'est, ce qui se passe, et l'action qui s'impose. */
export function SessionHead({ view, result, busy, onRun, onCancel }: Props) {
  const row = buildRow(view, Date.now());
  const video = isVideoSession(view);
  const engine = engineLabel(view.engine ?? view.asr);
  const spent =
    typeof view.duration_s === "number" && view.duration_s > 0
      ? view.duration_s
      : null;
  const factor = formatRealtimeFactor(view.audio_duration_s, spent);
  const riwaya = result?.riwaya;
  return (
    <header className="o-head session-head" data-testid="session-head">
      <h1 data-testid="session-title">{view.name}</h1>
      <div className="facts">
        <span className="f">
          <Icon name={video ? "video" : "audio"} />
          {video ? "Vidéo" : "Audio"}
          {view.audio_duration_s ? (
            <>
              {" · "}
              <span className="mono">
                {formatClockLength(view.audio_duration_s)}
              </span>
            </>
          ) : null}
        </span>
        {engine ? <span className="f">{engine}</span> : null}
        <span className="f" data-testid="session-status">
          {view.state === "done" && spent !== null ? (
            <>
              Terminé en <b className="mono">{formatDurationFr(spent)}</b>
              {factor ? ` · ${factor} temps réel` : ""}
            </>
          ) : (
            row.status
          )}
        </span>
        {riwaya && !riwaya.verified ? (
          <span
            className="f riwaya"
            tabIndex={0}
            data-testid="riwaya-notice"
            title={riwaya.notice}
          >
            Riwaya {riwaya.assumed === "hafs" ? "Hafs" : riwaya.assumed}{" "}
            supposée · non vérifiée
          </span>
        ) : null}
        <span className="f mono muted">
          SHA-256 {view.audio_sha256.slice(0, 12)}…
        </span>
      </div>
      {view.error && view.state !== "done" ? (
        <p className="notice notice--error" role="alert">
          {view.error}
        </p>
      ) : null}
      {view.state === "ready" ||
      view.state === "failed" ||
      view.state === "cancelled" ? (
        <div>
          <button
            type="button"
            className="btn btn--primary"
            data-testid="run-engine"
            disabled={busy}
            onClick={onRun}
          >
            {view.state === "ready" ? "Lancer l’analyse" : "Relancer l’analyse"}
          </button>
        </div>
      ) : view.state === "running" || view.state === "queued" ? (
        <div>
          <button
            type="button"
            className="btn btn--danger"
            data-testid="cancel-run"
            disabled={busy}
            onClick={onCancel}
          >
            {view.state === "queued"
              ? "Retirer de la file"
              : "Arrêter le traitement"}
          </button>
        </div>
      ) : null}
    </header>
  );
}
