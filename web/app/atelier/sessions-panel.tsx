"use client";
import { useMemo, useState } from "react";
import {
  buildRow,
  filterViews,
  groupViews,
  queueSummary,
  sessionCounts,
  type SessionFilter,
  type SessionRow,
} from "@/lib/session-list";
import type { SessionView } from "@/lib/session-view";
import { Icon, SessionGlyph } from "./icons";

type Props = {
  views: readonly SessionView[];
  loaded: boolean;
  currentId: string | null;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  onRetry: (id: string) => void;
  onClose: () => void;
  onPerf: () => void;
};

function Row({
  row,
  current,
  onOpen,
  onRetry,
}: {
  row: SessionRow;
  current: boolean;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const running = row.glyph === "running";
  return (
    <li className={row.canRetry ? "has-retry" : undefined}>
      <button
        type="button"
        className="sess"
        data-testid="session-row"
        data-id={row.id}
        data-state={row.glyph}
        data-tone={row.tone}
        data-unread={row.unread}
        aria-current={current ? "true" : undefined}
        onClick={onOpen}
      >
        <span className="sess-glyph">
          <SessionGlyph
            state={row.glyph}
            rank={row.rank}
            progress={row.progress}
          />
        </span>
        <span className="sess-name" title={row.name}>
          {row.name}
        </span>
        <span className="sess-end">
          {row.unread ? (
            <span
              className="unread"
              data-testid="unread-dot"
              aria-hidden="true"
            />
          ) : null}
          <span>{row.endLabel}</span>
        </span>
        <span className="sess-status">
          {row.unread ? <span className="sr">Non lue · </span> : null}
          {row.status}
        </span>
        <span className="sess-meta">
          <Icon name={row.mediaKind === "video" ? "video" : "audio"} />
          {row.meta}
        </span>
        {running ? (
          <span
            className="sess-bar"
            aria-hidden="true"
            data-indeterminate={row.indeterminate}
          >
            <i
              style={
                row.progress === null
                  ? undefined
                  : ({
                      "--p": `${Math.round(row.progress * 100)}%`,
                    } as React.CSSProperties)
              }
            />
          </span>
        ) : null}
      </button>
      {row.canRetry ? (
        <button
          type="button"
          className="btn btn--secondary btn--sm retry"
          data-testid="retry"
          onClick={onRetry}
        >
          Relancer
        </button>
      ) : null}
    </li>
  );
}

export function SessionsPanel(props: Props) {
  const [filter, setFilter] = useState<SessionFilter>("all");
  const now = Date.now();
  const counts = useMemo(() => sessionCounts(props.views), [props.views]);
  const summary = useMemo(() => queueSummary(props.views), [props.views]);
  const shown = useMemo(
    () => filterViews(props.views, filter),
    [props.views, filter],
  );
  const groups = useMemo(() => groupViews(shown), [shown]);
  const chip = (id: SessionFilter, label: string, n: number) => (
    <button
      type="button"
      className="chip"
      data-testid={`filter-${id}`}
      aria-pressed={filter === id}
      onClick={() => setFilter(id)}
    >
      {label} <span className="n">{n}</span>
    </button>
  );
  const list = (items: SessionView[]) =>
    items.map((view) => (
      <Row
        key={view.id}
        row={buildRow(view, now)}
        current={props.currentId === view.id}
        onOpen={() => props.onOpen(view.id)}
        onRetry={() => props.onRetry(view.id)}
      />
    ));
  return (
    <div className="panel-in">
      <div className="panel-head">
        <h2>Sessions</h2>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          data-testid="refresh"
          aria-label="Actualiser la liste"
          onClick={props.onRefresh}
        >
          <Icon name="refresh" />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm drawer-close only-drawer"
          aria-label="Fermer la liste des sessions"
          onClick={props.onClose}
        >
          <Icon name="x" />
        </button>
      </div>
      <div className="filters" role="group" aria-label="Filtrer les sessions">
        {chip("all", "Toutes", counts.all)}
        {chip("active", "En cours", counts.active)}
        {chip("unread", "Non lues", counts.unread)}
      </div>
      {summary ? (
        <p className="queue-line" role="status" data-testid="queue-line">
          <Icon name="wave" />
          <span>{summary}</span>
        </p>
      ) : null}
      {props.views.length === 0 ? (
        <p className="sess-empty">
          {props.loaded
            ? "Aucun essai local. Dépose un audio ou une vidéo, ou enregistre une récitation."
            : "Chargement…"}
        </p>
      ) : shown.length === 0 ? (
        <p className="sess-empty">Aucune session ne correspond à ce filtre.</p>
      ) : (
        <>
          {groups.queue.length > 0 ? (
            <>
              <h3 className="eyebrow group-title">File d’analyse</h3>
              <ul data-testid="list-queue">{list(groups.queue)}</ul>
            </>
          ) : null}
          {groups.ready.length > 0 ? (
            <>
              <h3 className="eyebrow group-title">Prêtes à analyser</h3>
              <ul data-testid="list-ready">{list(groups.ready)}</ul>
            </>
          ) : null}
          {groups.done.length > 0 ? (
            <>
              <h3 className="eyebrow group-title">Terminées</h3>
              <ul data-testid="list-done">{list(groups.done)}</ul>
            </>
          ) : null}
        </>
      )}
      <div className="sess-foot only-drawer">
        <button
          type="button"
          className="btn btn--secondary btn--block"
          onClick={props.onPerf}
        >
          <Icon name="gauge" />
          Performance
        </button>
      </div>
    </div>
  );
}
