"use client";
import { useRef, useState } from "react";
import type { ApiSession } from "@/lib/api-types";
import {
  formatBytesFr,
  formatClockLength,
  formatDurationFr,
  formatRealtimeFactor,
} from "@/lib/format";
import type { Recognition } from "@/lib/recognition";
import { buildRow, engineLabel, isVideoSession } from "@/lib/session-list";
import { Icon } from "./icons";
import { FavButton, InlineName, ScopeBadge, useDismiss } from "./session-bits";

type Props = {
  view: ApiSession;
  result: Recognition | null;
  busy: boolean;
  onRun: () => void;
  onCancel: () => void;
  onRename: (name: string | null) => void | Promise<void>;
  onFavorite: () => void;
  onVisibility: (visibility: "global" | "private") => void;
  onArchive: (archived: boolean) => void;
};

/** Fenêtre « Qui peut voir cette session ? » : deux cartes radio, confirmation avant d'ouvrir à tous. */
function ScopePicker({
  view,
  onVisibility,
}: {
  view: ApiSession;
  onVisibility: (visibility: "global" | "private") => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useDismiss(
    open,
    () => {
      setOpen(false);
      setConfirm(false);
    },
    wrap,
    button,
  );
  const choose = (visibility: "global" | "private") => {
    if (visibility === view.visibility) return setOpen(false);
    if (visibility === "global") return setConfirm(true);
    setOpen(false);
    onVisibility("private");
  };
  return (
    <span className="f pop-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="btn btn--ghost btn--sm"
        data-testid="scope-button"
        style={{ margin: "-6px -8px" }}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Modifier la portée"
        onClick={() => setOpen((v) => !v)}
      >
        <ScopeBadge visibility={view.visibility} />
        <Icon name="chevron-d" size={16} />
      </button>
      {open ? (
        <div
          className="scope-pop"
          role="dialog"
          aria-label="Portée de la session"
        >
          <p className="eyebrow">Qui peut voir cette session ?</p>
          <button
            className="radio-card"
            type="button"
            role="radio"
            data-testid="scope-global"
            aria-checked={view.visibility === "global"}
            onClick={() => choose("global")}
          >
            <span className="radio" aria-hidden="true" />
            <b>
              <Icon name="globe" />
              Global
            </b>
            <span className="d">
              Tous les testeurs l’écoutent et voient ses résultats et ses
              performances.
            </span>
          </button>
          <button
            className="radio-card"
            type="button"
            role="radio"
            data-testid="scope-private"
            aria-checked={view.visibility === "private"}
            onClick={() => choose("private")}
          >
            <span className="radio" aria-hidden="true" />
            <b>
              <Icon name="lock" />
              Privé
            </b>
            <span className="d">
              Toi seul. Il n’apparaît ni dans les listes des autres ni dans
              leurs statistiques.
            </span>
          </button>
          {confirm ? (
            <div className="scope-confirm">
              <p className="banner">
                <small>
                  Tout le monde pourra écouter cet audio et voir ses résultats.
                  Tu pourras le repasser en privé à tout moment.
                </small>
              </p>
              <div className="btnrow" style={{ marginTop: 8 }}>
                <button
                  className="btn btn--primary btn--sm"
                  type="button"
                  data-testid="scope-confirm"
                  onClick={() => {
                    setOpen(false);
                    setConfirm(false);
                    onVisibility("global");
                  }}
                >
                  Rendre global
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => setConfirm(false)}
                >
                  Annuler
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

/** Titre de la session ouverte : ce que c'est, ce qui se passe, et l'action qui s'impose. */
export function SessionHead({
  view,
  result,
  busy,
  onRun,
  onCancel,
  onRename,
  onFavorite,
  onVisibility,
  onArchive,
}: Props) {
  const row = buildRow(view, Date.now());
  const video = isVideoSession(view);
  const engine = engineLabel(view.engine ?? view.asr);
  const spent =
    typeof view.duration_s === "number" && view.duration_s > 0
      ? view.duration_s
      : null;
  const factor = formatRealtimeFactor(view.audio_duration_s, spent);
  const riwaya = result?.riwaya;
  const canUseLabel =
    view.can_edit && view.content_label && view.content_label !== view.name;
  return (
    <header className="o-head session-head" data-testid="session-head">
      <div
        className="title-row-wrap"
        style={{ display: "flex", alignItems: "center", gap: 4 }}
      >
        <div style={{ flex: "0 1 auto", minWidth: 0 }}>
          <InlineName
            name={view.name}
            canEdit={view.can_edit}
            onRename={onRename}
          />
        </div>
        <FavButton favorite={view.favorite} onToggle={onFavorite} />
      </div>
      {view.content_label ? (
        <p className="detected" data-testid="content-label">
          <Icon name="wave" />
          <span>
            Contenu détecté : <b>{view.content_label}</b>
          </span>
          {canUseLabel ? (
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              data-testid="use-as-name"
              onClick={() => void onRename(view.content_label)}
            >
              Utiliser comme nom
            </button>
          ) : null}
        </p>
      ) : null}
      <div className="facts">
        {view.can_edit ? (
          <ScopePicker view={view} onVisibility={onVisibility} />
        ) : (
          <span className="f">
            <ScopeBadge visibility={view.visibility} />
          </span>
        )}
        {!view.mine ? (
          <span className="f" data-testid="owner-fact">
            <Icon name="user" />
            Propriétaire :{" "}
            <b style={{ fontWeight: 600, color: "var(--text)" }}>
              {view.owner?.username ?? "avant les comptes"}
            </b>
          </span>
        ) : null}
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
          {" · "}
          <span className="mono">{formatBytesFr(view.size_bytes)}</span>
        </span>
        {engine ? <span className="f m-hide">{engine}</span> : null}
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
        <span className="f mono muted m-hide">
          SHA-256 {view.audio_sha256.slice(0, 12)}…
        </span>
        <button
          className="btn btn--ghost btn--sm"
          type="button"
          data-testid="archive"
          aria-pressed={Boolean(view.archived_at)}
          onClick={() => onArchive(!view.archived_at)}
        >
          <Icon name={view.archived_at ? "undo" : "archive"} />
          <span>{view.archived_at ? "Restaurer" : "Archiver"}</span>
        </button>
      </div>
      {view.error && view.state !== "done" ? (
        <p className="notice notice--error" role="alert">
          {view.error}
        </p>
      ) : null}
      {view.can_edit &&
      (view.state === "ready" ||
        view.state === "failed" ||
        view.state === "cancelled") ? (
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
      ) : view.can_edit &&
        (view.state === "running" || view.state === "queued") ? (
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
