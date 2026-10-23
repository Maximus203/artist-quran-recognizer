"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "@/lib/api-client";
import type { ApiSession } from "@/lib/api-types";
import { formatBytesFr } from "@/lib/format";
import { groupByDate } from "@/lib/session-groups";
import {
  activeFilterCount,
  clearedFilter,
  filterFromUrl,
  filterToUrl,
  fromPreference,
  hasUrlFilter,
  toPreference,
  type SessionsFilter,
} from "@/lib/sessions-filter";
import { HeroWave } from "./hero-wave";
import { Icon } from "./icons";
import { SelectionBar } from "./selection-bar";
import { SessionListRow, type RowActions } from "./session-list-row";
import { SessionsToolbar, SORT_OPTIONS } from "./sessions-toolbar";
import { useShell } from "./shell";
import { useToast } from "./use-toast";
import {
  bulkSessions,
  deleteSession,
  patchSession,
  setFavorite,
  useSessionFeed,
  type BulkAction,
} from "./use-sessions";

const PAGE_SIZE = 20;
const CHUNK = 100;
const PERSISTED = ["scope", "states", "engines", "sort"] as const;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

/** Page « Sessions » : la liste complète, avec recherche, filtres, tri, groupes par date et actions groupées. */
export function SessionsPage({ search }: { search: string }) {
  const { prefs, update, refreshQuota, quota } = useShell();
  const [filter, setFilter] = useState<SessionsFilter>(() => {
    const params = new URLSearchParams(search);
    return hasUrlFilter(params)
      ? filterFromUrl(params)
      : fromPreference(prefs.sessionsFilter);
  });
  const feed = useSessionFeed(filter, PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const { show, node: toastNode } = useToast();
  const now = Date.now();
  const listRef = useRef<HTMLElement>(null);
  const focusAfter = useRef<string | null>(null);
  const shownBefore = useRef(0);

  const say = useCallback((text: string) => {
    setAnnouncement("");
    setTimeout(() => setAnnouncement(text), 30);
  }, []);

  /* ── filtre ↔ adresse de la page ── */
  useEffect(() => {
    const qs = filterToUrl(filter).toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }, [filter]);
  const change = useCallback(
    (patch: Partial<SessionsFilter>) => {
      setFilter((current) => {
        const next = { ...current, ...patch };
        if (PERSISTED.some((key) => key in patch))
          update({ sessionsFilter: toPreference(next) });
        return next;
      });
      setSelected(new Set());
    },
    [update],
  );
  const clearAll = useCallback(
    () => change(clearedFilter(filter)),
    [change, filter],
  );

  /* ── annonce des résultats ── */
  useEffect(() => {
    if (feed.status === "ready")
      say(`${plural(feed.total, "session", "sessions")}`);
  }, [feed.status, feed.total, say]);

  /* ── « Charger plus » : le focus passe à la première ligne nouvelle ── */
  useEffect(() => {
    if (
      focusAfter.current !== null &&
      feed.items.length > shownBefore.current
    ) {
      const target = feed.items[shownBefore.current];
      const link = listRef.current?.querySelector<HTMLElement>(
        `[data-id="${target.id}"] a.sname`,
      );
      link?.focus();
      say(
        `${plural(feed.items.length, "session affichée", "sessions affichées")}`,
      );
      focusAfter.current = null;
    }
  }, [feed.items, say]);
  const loadMore = () => {
    shownBefore.current = feed.items.length;
    focusAfter.current = "more";
    void feed.loadMore();
  };

  /* ── sélection ── */
  const byId = useMemo(
    () => new Map(feed.items.map((s) => [s.id, s])),
    [feed.items],
  );
  const chosen = useMemo(
    () =>
      [...selected]
        .map((id) => byId.get(id))
        .filter((s): s is ApiSession => Boolean(s)),
    [selected, byId],
  );
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selected.size > 0) setSelected(new Set());
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selected.size]);
  const select = (id: string, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const allSelected =
    feed.items.length > 0 && feed.items.every((s) => selected.has(s.id));
  const selectAll = (on: boolean) =>
    setSelected(on ? new Set(feed.items.map((s) => s.id)) : new Set());

  /* ── actions ── */
  const fail = useCallback(
    (error: unknown) =>
      show(error instanceof Error ? error.message : "Action impossible"),
    [show],
  );

  /** Action groupée par lots de 100 ; renvoie les identifiants réellement modifiés. */
  const runBulk = useCallback(async (ids: string[], action: BulkAction) => {
    const applied: string[] = [];
    let forbidden = 0;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const result = await bulkSessions(ids.slice(i, i + CHUNK), action);
      for (const r of result.results) {
        if (r.status === "ok") applied.push(r.id);
        else forbidden += 1;
      }
    }
    return { applied, forbidden };
  }, []);

  const favorite = useCallback(
    async (s: ApiSession) => {
      const on = !s.favorite;
      feed.patchItem(s.id, { favorite: on });
      try {
        await setFavorite(s.id, on);
        say(on ? "Ajouté aux favoris" : "Retiré des favoris");
        if (filter.scope === "favorites" && !on) feed.removeItems([s.id]);
      } catch (e) {
        feed.patchItem(s.id, { favorite: !on });
        fail(e);
      }
    },
    [feed, filter.scope, say, fail],
  );

  const bulkFavorite = useCallback(
    async (on: boolean) => {
      try {
        const { applied } = await runBulk([...selected], {
          action: on ? "favorite" : "unfavorite",
        });
        for (const id of applied) feed.patchItem(id, { favorite: on });
        if (filter.scope === "favorites" && !on) feed.removeItems(applied);
        setSelected(new Set());
        show(
          on
            ? `${plural(applied.length, "session ajoutée", "sessions ajoutées")} aux favoris`
            : `${plural(applied.length, "session retirée", "sessions retirées")} des favoris`,
        );
      } catch (e) {
        fail(e);
      }
    },
    [runBulk, selected, feed, filter.scope, show, fail],
  );

  const archive = useCallback(
    async (ids: string[], archived: boolean) => {
      try {
        const { applied, forbidden } = await runBulk(ids, {
          action: archived ? "archive" : "unarchive",
        });
        feed.removeItems(applied);
        setSelected(new Set());
        if (applied.length === 0 && forbidden > 0)
          return show("Tu ne peux pas modifier ces sessions.");
        show(
          archived
            ? `${plural(applied.length, "session archivée", "sessions archivées")}`
            : applied.length > 1
              ? `${applied.length} sessions restaurées`
              : "Session restaurée",
          {
            label: "Annuler",
            run: () =>
              void runBulk(applied, {
                action: archived ? "unarchive" : "archive",
              })
                .then(() => feed.reload())
                .catch(fail),
          },
        );
      } catch (e) {
        fail(e);
      }
    },
    [runBulk, feed, show, fail],
  );

  const setVisibility = useCallback(
    async (ids: string[], visibility: "global" | "private") => {
      const previous = new Map(
        ids.map((id) => [id, byId.get(id)?.visibility ?? "global"]),
      );
      try {
        const { applied, forbidden } = await runBulk(ids, {
          action: "set_visibility",
          visibility,
        });
        for (const id of applied) feed.patchItem(id, { visibility });
        setSelected(new Set());
        if (applied.length === 0)
          return show(
            forbidden
              ? "Seul le propriétaire change la portée d’une session."
              : "Rien à modifier.",
          );
        show(
          visibility === "global"
            ? `${plural(applied.length, "session rendue globale", "sessions rendues globales")}`
            : `${plural(applied.length, "session rendue privée", "sessions rendues privées")}`,
          {
            label: "Annuler",
            run: () => {
              for (const id of applied) {
                const before = previous.get(id) ?? "global";
                void patchSession(id, { visibility: before })
                  .then(() => feed.patchItem(id, { visibility: before }))
                  .catch(fail);
              }
            },
          },
        );
      } catch (e) {
        fail(e);
      }
    },
    [runBulk, byId, feed, show, fail],
  );

  const rename = useCallback(
    async (s: ApiSession, name: string | null) => {
      try {
        const { session } = await patchSession(s.id, { name });
        feed.patchItem(s.id, {
          name: session.name,
          name_source: session.name_source,
        });
        say(
          name === null
            ? "Nom par défaut rétabli"
            : `Nom enregistré : ${session.name}`,
        );
      } catch (e) {
        fail(e);
      }
    },
    [feed, say, fail],
  );

  const remove = useCallback(
    async (targets: ApiSession[]) => {
      const done: string[] = [];
      let blocked = 0;
      for (const s of targets) {
        try {
          await deleteSession(s.id);
          done.push(s.id);
        } catch (e) {
          if (e instanceof ApiError && e.code === "review_work") blocked += 1;
          else return fail(e);
        }
      }
      feed.removeItems(done);
      setSelected(new Set());
      void refreshQuota();
      show(
        blocked
          ? `${plural(done.length, "session supprimée", "sessions supprimées")} · ${plural(blocked, "contient", "contiennent")} du travail de revue : ouvre-${blocked > 1 ? "les" : "la"} pour la supprimer en connaissance de cause.`
          : plural(done.length, "session supprimée", "sessions supprimées"),
      );
    },
    [feed, refreshQuota, show, fail],
  );

  const rowActions: RowActions = {
    onFavorite: (s) => void favorite(s),
    onRename: rename,
    onVisibility: (s, v) => void setVisibility([s.id], v),
    onArchive: (s, archived) => void archive([s.id], archived),
    onDelete: (s) => void remove([s]),
  };

  /* ── rendu ── */
  const archivedScope = filter.scope === "archived";
  const groups = useMemo(
    () => groupByDate(feed.items, filter.sort, now),
    // `now` change à chaque rendu : la date de référence ne bouge qu'avec la liste
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.items, filter.sort],
  );
  const counts = feed.counts;
  // La synthèse du haut décrit TOUTES mes sessions : elle ne suit pas la recherche ni les dates.
  const overall = useRef(counts);
  if (
    counts &&
    !filter.q.trim() &&
    !filter.from &&
    !filter.to &&
    filter.engines.length === 0
  )
    overall.current = counts;
  const summary = overall.current ?? counts;
  const noSessionAtAll =
    feed.status === "ready" &&
    feed.items.length === 0 &&
    activeFilterCount(filter) === 0 &&
    (counts?.scopes.all ?? 0) === 0 &&
    filter.scope === "all";
  const archiveHint =
    feed.status === "ready" &&
    feed.items.length === 0 &&
    filter.scope !== "archived" &&
    (counts?.scopes.archived ?? 0) > 0 &&
    activeFilterCount(filter) > 0;
  const foreign = chosen.filter((s) => !s.can_edit).length;
  const allFavorite = chosen.length > 0 && chosen.every((s) => s.favorite);
  const deletable =
    archivedScope && chosen.length > 0 && chosen.every((s) => s.can_edit);

  return (
    <div className="page" data-testid="sessions-page">
      <div className="pg-title">
        <div>
          <h1>Sessions</h1>
          <p aria-live="polite" data-testid="summary">
            {summary
              ? `${plural(summary.scopes.all, "session", "sessions")} · ${summary.scopes.mine} à toi · ${formatBytesFr(quota.used_bytes)} utilisés`
              : "Chargement…"}
          </p>
        </div>
        <Link className="btn btn--primary" href="/?vue=new">
          <Icon name="plus" />
          Nouvel essai
        </Link>
      </div>

      <SessionsToolbar
        filter={filter}
        onChange={change}
        onClearAll={clearAll}
        counts={counts}
        selectMode={selectMode}
        onSelectMode={() => {
          setSelectMode((v) => !v);
          setSelected(new Set());
        }}
      />

      <div className="result-line">
        <span aria-live="polite" data-testid="count">
          {feed.status === "ready" ? (
            <>
              <b>{feed.total}</b> session{feed.total > 1 ? "s" : ""}
              {archivedScope ? ` archivée${feed.total > 1 ? "s" : ""}` : ""}
            </>
          ) : feed.status === "loading" ? (
            "Chargement des sessions…"
          ) : (
            ""
          )}
        </span>
        <label className="sort">
          Trier par
          <select
            className="input"
            data-testid="sort"
            value={filter.sort}
            onChange={(event) =>
              change({ sort: event.target.value as SessionsFilter["sort"] })
            }
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {feed.status === "error" && feed.items.length > 0 ? (
        <div className="form-alert has-error-banner" role="alert">
          <Icon name="alert" />
          <div>
            <b>Impossible de charger les sessions.</b>
            <br />
            <span>
              Le serveur ne répond pas pour l’instant. Tes sessions n’ont pas
              disparu.
            </span>
            <div className="btnrow" style={{ marginTop: 8 }}>
              <button
                className="btn btn--secondary btn--sm"
                type="button"
                onClick={() => void feed.reload()}
              >
                Réessayer
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section
        ref={listRef}
        className="card list-card"
        aria-label="Liste des sessions"
        aria-busy={feed.status === "loading"}
        data-select={selectMode}
        data-testid="session-list"
      >
        {feed.items.length > 0 ? (
          <>
            <div className="shead" aria-hidden={false}>
              <span className="check" style={{ justifyContent: "center" }}>
                <input
                  type="checkbox"
                  aria-label="Tout sélectionner sur la page"
                  checked={allSelected}
                  ref={(el) => {
                    if (el)
                      el.indeterminate = selected.size > 0 && !allSelected;
                  }}
                  onChange={(event) => selectAll(event.target.checked)}
                />
              </span>
              <span aria-hidden="true" />
              <button
                type="button"
                aria-current={filter.sort === "name" ? "true" : undefined}
                onClick={() => change({ sort: "name" })}
              >
                Nom
              </button>
              <span>Importé par</span>
              <span>Portée</span>
              <button
                type="button"
                data-num
                aria-current={filter.sort === "duration" ? "true" : undefined}
                onClick={() => change({ sort: "duration" })}
              >
                Durée
              </button>
              <button
                type="button"
                data-num
                aria-current={filter.sort === "size" ? "true" : undefined}
                onClick={() => change({ sort: "size" })}
              >
                Taille
              </button>
              <span>Moteur</span>
              <button
                type="button"
                aria-current={
                  filter.sort === "recent" || filter.sort === "oldest"
                    ? "true"
                    : undefined
                }
                onClick={() =>
                  change({
                    sort: filter.sort === "recent" ? "oldest" : "recent",
                  })
                }
              >
                Date
              </button>
              <span className="sr">Favori</span>
              <span className="sr">Actions</span>
            </div>
            <div className="select-all only-narrow-sel">
              <label className="check">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(event) => selectAll(event.target.checked)}
                />
                Tout sélectionner
              </label>
            </div>
            {groups.map((group, index) => (
              <section
                key={group.key}
                aria-labelledby={group.label ? `g${index}` : undefined}
              >
                {group.label ? (
                  <div className="grp-head">
                    <h2 id={`g${index}`}>{group.label}</h2>
                    <span className="n">{group.items.length}</span>
                  </div>
                ) : null}
                <ul>
                  {group.items.map((s) => (
                    <SessionListRow
                      key={s.id}
                      session={s}
                      now={now}
                      selected={selected.has(s.id)}
                      onSelect={(on) => select(s.id, on)}
                      actions={rowActions}
                      archivedScope={archivedScope}
                    />
                  ))}
                </ul>
              </section>
            ))}
          </>
        ) : feed.status === "loading" ? (
          Array.from({ length: 7 }, (_, i) => (
            <div className="skel" aria-hidden="true" key={i}>
              <span className="c">
                <i />
              </span>
              <span className="g">
                <i />
              </span>
              <span className="l">
                <i />
                <i />
              </span>
            </div>
          ))
        ) : feed.status === "error" ? (
          <div className="state-box state-box--error" data-testid="list-error">
            <Icon name="alert" className="big" />
            <h2>La liste ne s’est pas chargée</h2>
            <p>
              Vérifie ta connexion, puis réessaie. Si le problème dure, préviens
              l’administrateur.
            </p>
            <div className="acts">
              <button
                className="btn btn--secondary"
                type="button"
                onClick={() => void feed.reload()}
              >
                Réessayer
              </button>
            </div>
          </div>
        ) : noSessionAtAll ? (
          <div className="state-box" data-testid="no-session">
            <HeroWave />
            <h2>Aucune session pour l’instant</h2>
            <p>
              Enregistre un passage au micro ou importe un audio ou une vidéo :
              l’analyse démarre toute seule et le résultat apparaît ici.
            </p>
            <div className="acts">
              <Link className="btn btn--primary" href="/?vue=new">
                <Icon name="plus" />
                Nouvel essai
              </Link>
            </div>
          </div>
        ) : (
          <div className="state-box" data-testid="no-result">
            <Icon name="search" className="big" />
            <h2>Aucune session ne correspond</h2>
            <p>
              {archivedScope
                ? "Rien dans les archives pour l’instant."
                : "Essaie un autre mot, élargis la période ou retire un filtre."}
            </p>
            {archiveHint ? (
              <p>Une session correspondante est peut-être dans les archives.</p>
            ) : null}
            {activeFilterCount(filter) > 0 ? (
              <div className="acts">
                <button
                  className="btn btn--secondary"
                  type="button"
                  onClick={clearAll}
                >
                  <Icon name="filter-x" />
                  Effacer les filtres
                </button>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {feed.hasMore ? (
        <div className="loadmore" data-testid="load-more-box">
          <progress
            max={100}
            value={
              feed.total
                ? Math.round((feed.items.length / feed.total) * 100)
                : 0
            }
            aria-hidden="true"
          />
          <span>
            {feed.items.length} sessions affichées sur {feed.total}
          </span>
          {feed.error ? (
            <span role="alert">Impossible de charger la suite.</span>
          ) : null}
          <button
            className="btn btn--secondary"
            type="button"
            data-testid="load-more"
            disabled={feed.loadingMore}
            onClick={loadMore}
          >
            {feed.loadingMore
              ? "Chargement…"
              : feed.error
                ? "Réessayer"
                : `Charger ${Math.min(PAGE_SIZE, feed.total - feed.items.length)} de plus`}
          </button>
        </div>
      ) : null}

      {selected.size > 0 ? (
        <SelectionBar
          count={selected.size}
          foreign={foreign}
          allFavorite={allFavorite}
          archivedScope={archivedScope}
          canDelete={deletable}
          onFavorite={() => void bulkFavorite(!allFavorite)}
          onArchive={() => void archive([...selected], !archivedScope)}
          onVisibility={(v) => void setVisibility([...selected], v)}
          onDelete={() => void remove(chosen)}
          onCancel={() => setSelected(new Set())}
        />
      ) : null}

      <div className="sr" role="status" aria-live="polite" data-testid="live">
        {announcement}
      </div>
      {toastNode}
    </div>
  );
}
