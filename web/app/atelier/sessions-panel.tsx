"use client";
import Link from "next/link";
import { useMemo } from "react";
import type { ApiSession } from "@/lib/api-types";
import { buildRow, queueSummary, type SessionRow } from "@/lib/session-list";
import { Avatar, useOwnerPerson } from "./avatar";
import { Icon, SessionGlyph } from "./icons";
import {
  SIDEBAR_FAVORITES,
  SIDEBAR_RECENT,
  type Sidebar,
} from "./use-sessions";

type Props = {
  data: Sidebar;
  currentId: string | null;
  onOpen: (id: string) => void;
  onRefresh: () => void;
  onRetry: (id: string) => void;
  onClose: () => void;
};

const QUEUE_SHOWN = 3;

function Row({
  session,
  row,
  current,
  onOpen,
  onRetry,
}: {
  session: ApiSession;
  row: SessionRow;
  current: boolean;
  onOpen: () => void;
  onRetry: () => void;
}) {
  const running = row.glyph === "running";
  const owner = useOwnerPerson(session.owner);
  const status = owner ? `${owner.username} · ${row.status}` : row.status;
  return (
    <li className={row.canRetry && session.can_edit ? "has-retry" : undefined}>
      <button
        type="button"
        className="sess is-compact"
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
          {session.visibility === "private" ? (
            <>
              <Icon name="lock" className="i-lock-inline" />
              <span className="sr">Privée · </span>
            </>
          ) : null}
          <span className="t">{row.name}</span>
        </span>
        <span className="sess-who" data-testid="session-owner">
          {owner ? <Avatar person={owner} size="sm" /> : null}
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
          {status}
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
      {row.canRetry && session.can_edit ? (
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

/**
 * Barre de gauche : elle raccourcit, elle ne liste plus. La file d'analyse, quelques favoris
 * épinglés, les huit plus récentes, puis un bouton vers la page « Sessions » (la liste complète).
 */
export function SessionsPanel({
  data,
  currentId,
  onOpen,
  onRefresh,
  onRetry,
  onClose,
}: Props) {
  const now = Date.now();
  const mineQueue = useMemo(
    () => data.queue.filter((s) => s.mine),
    [data.queue],
  );
  const summary = useMemo(() => queueSummary(mineQueue), [mineQueue]);
  const favoritesTotal = data.counts?.scopes.favorites ?? data.favorites.length;
  const total = data.counts?.scopes.all ?? data.total;
  const render = (items: ApiSession[]) =>
    items.map((s) => (
      <Row
        key={s.id}
        session={s}
        row={buildRow(s, now)}
        current={currentId === s.id}
        onOpen={() => onOpen(s.id)}
        onRetry={() => onRetry(s.id)}
      />
    ));
  const empty =
    data.loaded &&
    !data.error &&
    mineQueue.length === 0 &&
    data.favorites.length === 0 &&
    data.recent.length === 0;
  return (
    <div className="panel-in">
      <div className="panel-head">
        <h2>Sessions</h2>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm"
          data-testid="refresh"
          aria-label="Actualiser la liste"
          onClick={onRefresh}
        >
          <Icon name="refresh" />
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--icon btn--sm drawer-close only-drawer"
          aria-label="Fermer la liste des sessions"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </div>
      {summary ? (
        <p className="queue-line" role="status" data-testid="queue-line">
          <Icon name="wave" />
          <span>{summary}</span>
        </p>
      ) : null}
      {data.error ? (
        <p className="sess-empty" role="alert">
          {data.error}
        </p>
      ) : !data.loaded ? (
        <p className="sess-empty">Chargement…</p>
      ) : empty ? (
        <p className="sess-empty">
          Aucune session. Dépose un audio ou une vidéo, ou enregistre une
          récitation.
        </p>
      ) : (
        <>
          {mineQueue.length > 0 ? (
            <section className="grp" aria-labelledby="g-queue">
              <h3 className="grp-title">
                <span className="eyebrow" id="g-queue">
                  File d’analyse
                </span>
                {mineQueue.length > QUEUE_SHOWN ? (
                  <span className="more-n">
                    + {mineQueue.length - QUEUE_SHOWN}
                  </span>
                ) : null}
              </h3>
              <ul data-testid="list-queue">
                {render(mineQueue.slice(0, QUEUE_SHOWN))}
              </ul>
            </section>
          ) : null}
          {data.favorites.length > 0 ? (
            <section className="grp" aria-labelledby="g-fav">
              <h3 className="grp-title">
                <span className="eyebrow" id="g-fav">
                  Favoris
                </span>
                <span className="more-n">{favoritesTotal}</span>
              </h3>
              <ul data-testid="list-favorites">
                {render(data.favorites.slice(0, SIDEBAR_FAVORITES - 1))}
              </ul>
              {favoritesTotal > SIDEBAR_FAVORITES - 1 ? (
                <div className="see-all">
                  <Link
                    className="btn btn--ghost btn--sm btn--block"
                    href="/sessions?portee=fav"
                  >
                    Voir les {favoritesTotal} favoris
                  </Link>
                </div>
              ) : null}
            </section>
          ) : null}
          {data.recent.length > 0 ? (
            <section className="grp" aria-labelledby="g-rec">
              <h3 className="grp-title">
                <span className="eyebrow" id="g-rec">
                  Récentes
                </span>
                <span className="more-n">
                  {Math.min(SIDEBAR_RECENT, data.recent.length)} sur {total}
                </span>
              </h3>
              <ul data-testid="list-recent">{render(data.recent)}</ul>
            </section>
          ) : null}
        </>
      )}
      <div className="see-all">
        <Link
          className="btn btn--secondary btn--block"
          href="/sessions"
          data-testid="see-all"
        >
          Voir toutes les sessions <span className="n">{total}</span>
        </Link>
      </div>
      <nav className="panel-nav only-drawer" aria-label="Autres pages">
        <Link href="/performance">
          <Icon name="gauge" />
          Performance
        </Link>
        <Link href="/docs">
          <Icon name="book" />
          Documentation
        </Link>
        <Link href="/compte">
          <Icon name="sliders" />
          Préférences
        </Link>
      </nav>
    </div>
  );
}
