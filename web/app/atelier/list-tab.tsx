"use client";
import { formatRelative, formatTenths } from "@/lib/format";
import { presetLabel } from "@/lib/review-presets";
import type { Annotation } from "@/lib/review";
import { Icon } from "./icons";
import type { ReviewController } from "./use-review";

type Props = {
  review: ReviewController;
  sessionId: string;
  onJump: (a: Annotation) => void;
  onListen: (a: Annotation) => void;
  onEdit: (a: Annotation) => void;
};

export function ListTab({
  review,
  sessionId,
  onJump,
  onListen,
  onEdit,
}: Props) {
  const now = Date.now();
  const all = review.state.annotations;
  const list = review.visible;
  return (
    <>
      <div className="lfilters">
        <label className="field">
          <span>Testeur</span>
          <select
            className="input"
            data-testid="filter-tester"
            value={review.filters.tester}
            onChange={(event) =>
              review.setFilters({
                ...review.filters,
                tester: event.target.value,
              })
            }
          >
            <option value="all">Tous les testeurs</option>
            {review.testers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div
          className="seg-filters"
          style={{ margin: 0 }}
          role="group"
          aria-label="Filtrer par état"
        >
          {(
            [
              ["all", "Tous"],
              ["draft", "Brouillons"],
              ["confirmed", "Confirmés"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="chip"
              data-testid={`filter-state-${id}`}
              aria-pressed={review.filters.state === id}
              onClick={() =>
                review.setFilters({ ...review.filters, state: id })
              }
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint hint--xs">
          Le filtre s’applique aussi à la forme d’onde et à la piste Revue.
        </p>
      </div>
      <ul className="alist" data-testid="report-list">
        {list.length === 0 ? (
          <li className="empty-list">
            {all.length
              ? "Aucun signalement ne correspond à ce filtre."
              : "Aucun signalement pour l’instant. Ils apparaîtront ici, sur la forme d’onde et sur la piste Revue."}
          </li>
        ) : (
          list.map((a) => (
            <li
              key={a.id}
              className="aitem"
              data-testid="report-item"
              data-id={a.id}
              data-sel={review.state.selectedId === a.id}
            >
              <button
                type="button"
                className="aitem-main"
                data-testid="report-jump"
                aria-label={`Aller à ${formatTenths(a.start_s)}`}
                onClick={() => onJump(a)}
              >
                <span className="ai-top">
                  <span
                    className={`sw s-human${a.status === "draft" ? " draft" : ""}`}
                  >
                    <i />
                  </span>
                  <span className="mono">
                    {formatTenths(a.start_s)}
                    {a.end_s === null ? "" : ` – ${formatTenths(a.end_s)}`}
                  </span>
                  <span
                    className={`badge${a.status === "draft" ? " badge--outline" : ""}`}
                    data-testid="report-status"
                  >
                    {a.status === "draft" ? "Brouillon" : "Confirmé"}
                  </span>
                </span>
                <span className="ai-tags">
                  {a.tags.length ? (
                    <>
                      {presetLabel(a.tags[0])}
                      {a.tags.length > 1 ? (
                        <span className="muted"> + {a.tags.length - 1}</span>
                      ) : null}
                    </>
                  ) : (
                    <span className="muted">Commentaire seul</span>
                  )}
                </span>
                <span className="ai-meta">
                  {a.tester} · {formatRelative(a.updated_at, now)}
                  {a.description ? ` · ${a.description}` : ""}
                </span>
              </button>
              <div className="ai-acts">
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  data-testid="report-listen"
                  aria-label="Écouter ce signalement"
                  onClick={() => onListen(a)}
                >
                  <Icon name="play" fill />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon"
                  data-testid="report-edit"
                  aria-label="Modifier ce signalement"
                  onClick={() => onEdit(a)}
                >
                  <Icon name="edit" />
                </button>
              </div>
            </li>
          ))
        )}
      </ul>
      <div
        className="panel-sec"
        style={{ display: "grid", gap: "var(--sp-2)" }}
      >
        <a
          className="btn btn--secondary btn--block export"
          data-testid="export-bundle"
          href={`/api/sessions/${sessionId}/bundle`}
          download
        >
          <Icon name="download" />
          Pack complet (ZIP)
        </a>
        <a
          className="btn btn--ghost btn--block audio-download"
          data-testid="export-json"
          href={`/api/sessions/${sessionId}/export`}
          download
        >
          Exporter le bilan JSON
        </a>
        <p className="hint hint--faint">
          Le ZIP contient audio, prédiction et signalements, avec le pseudonyme
          de chaque testeur. Aucun envoi cloud automatique. Métriques
          indisponibles pour une revue partielle.
        </p>
      </div>
    </>
  );
}
