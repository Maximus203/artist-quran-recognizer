"use client";
import Link from "next/link";
import { useRef } from "react";
import type { ItemType } from "@/lib/decisions";
import {
  FILTER_ORDER,
  IMPACT_LABEL,
  TYPE_FILTER_LABEL,
  TYPE_LABEL,
  clock,
  decisionLabel,
  engineLabel,
  itemTitle,
  why,
  wordsLabel,
} from "@/lib/export-text";
import type { ReadinessItem, ReadinessPayload } from "@/lib/export-types";
import { Diamond, XIcon } from "./export-icons";

const GLYPH: Record<ItemType, string> = {
  uncertain: "s-uncertain",
  inferred: "s-inferred",
  cut: "s-recognized",
  approx: "s-recognized",
  report: "s-abstention",
};

export type RowActions = {
  /** Écouter le passage ; le même geste arrête une lecture en cours. */
  listen: (item: ReadinessItem) => void;
  playingKey: string | null;
  ignore: (item: ReadinessItem) => void;
  undo: (item: ReadinessItem) => void;
  /** Place la tête de lecture au début du passage, sans lancer le son. */
  seek: (item: ReadinessItem) => void;
  correctHref: (item: ReadinessItem) => string;
  canEdit: boolean;
  busyKey: string | null;
};

/** Une ligne : de quoi s'agit-il, pourquoi, et les trois gestes (écouter, corriger, ignorer). */
export function Row({
  item,
  actions,
}: {
  item: ReadinessItem;
  actions: RowActions;
}) {
  const done = item.state !== "open";
  const playing = actions.playingKey === item.key;
  const busy = actions.busyKey === item.key;
  return (
    <li
      className={`ex-xi${done ? " is-done" : ""}`}
      data-testid="ex-row"
      data-key={item.key}
      data-type={item.type}
      data-state={item.state}
    >
      <span className={`sw ${GLYPH[item.type]} ex-sw`} aria-hidden="true" />
      <div className="ex-xi-main" onClick={() => actions.seek(item)}>
        <div className="ex-xi-top">
          <span className="ex-xi-ref">{itemTitle(item)}</span>
          <span className="ex-xi-t">
            {clock(item.t[0])} → {clock(item.t[1])}
            {item.words ? ` · ${wordsLabel(item.words)}` : ""}
          </span>
        </div>
        {item.state === "open" ? (
          <p className="ex-xi-why">{why(item)}</p>
        ) : (
          <>
            <p className="ex-decision-line">
              <Diamond />
              <span>
                {item.state === "ignored" ? (
                  <>
                    <b>Ignoré</b> : exporté selon la règle par défaut.{" "}
                  </>
                ) : (
                  <>
                    Décision : <b>{decisionLabel(item.decision!)}</b>
                    {item.decision?.evidence.listened ? " · écouté" : ""}.{" "}
                  </>
                )}
                {actions.canEdit ? (
                  <button
                    type="button"
                    disabled={busy}
                    data-testid="undo-decision"
                    onClick={(event) => {
                      event.stopPropagation();
                      actions.undo(item);
                    }}
                  >
                    Annuler
                  </button>
                ) : null}
              </span>
            </p>
            <p className="ex-decision-line muted">
              <Diamond hollow />
              <span>Moteur : {engineLabel(item)}</span>
            </p>
          </>
        )}
        <div className="ex-xi-tags">
          <span className="ex-tag">
            {TYPE_LABEL[item.type]}
            {item.type === "uncertain" && item.candidates
              ? ` · ${item.candidates.length} candidats`
              : ""}
          </span>
          <span className="ex-tag ex-tag--ar">{IMPACT_LABEL[item.impact]}</span>
        </div>
      </div>
      <div className="ex-xi-act">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          data-testid="listen"
          aria-pressed={playing}
          onClick={() => actions.listen(item)}
        >
          <XIcon name={playing ? "stop" : "play"} size={16} />
          {playing ? "Arrêter" : "Écouter"}
        </button>
        {actions.canEdit ? (
          <Link
            className="btn btn--secondary btn--sm"
            href={actions.correctHref(item)}
            prefetch={false}
            data-testid="correct"
          >
            {done ? "Revoir" : "Corriger"}
          </Link>
        ) : null}
        {actions.canEdit && item.state === "open" ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={busy}
            data-testid="ignore"
            onClick={() => actions.ignore(item)}
          >
            Ignorer
          </button>
        ) : null}
      </div>
    </li>
  );
}

/** Le filtre par sorte de passage : des pastilles avec leur compteur (`aria-pressed`). */
export function Filters({
  payload,
  value,
  onChange,
}: {
  payload: ReadinessPayload;
  value: ItemType | null;
  onChange: (next: ItemType | null) => void;
}) {
  return (
    <div
      className="ex-fchips"
      role="group"
      aria-label="Filtrer par type"
      data-testid="filters"
    >
      <button
        type="button"
        className="chip"
        aria-pressed={value === null}
        onClick={() => onChange(null)}
      >
        Tous <span className="n">{payload.verdict.total}</span>
      </button>
      {FILTER_ORDER.filter((type) => payload.counts[type]).map((type) => (
        <button
          key={type}
          type="button"
          className="chip"
          aria-pressed={value === type}
          data-testid={`filter-${type}`}
          onClick={() => onChange(value === type ? null : type)}
        >
          {TYPE_FILTER_LABEL[type]}{" "}
          <span className="n">{payload.counts[type]!.total}</span>
        </button>
      ))}
    </div>
  );
}

/** La liste d'une page de passages, avec sa pagination et le saut au prochain passage non résolu. */
export function ReadinessList({
  payload,
  loading,
  slow,
  page,
  onPage,
  onNextOpen,
  actions,
}: {
  payload: ReadinessPayload;
  loading: boolean;
  slow: boolean;
  page: number;
  onPage: (page: number) => void;
  onNextOpen: () => void;
  actions: RowActions;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const { items, page: info } = payload;
  const move = (next: number) => {
    onPage(next);
    heading.current?.focus();
  };
  return (
    <div>
      <div className="ex-list-head">
        <h3 id="ex-list-h" ref={heading} tabIndex={-1}>
          À vérifier dans la partie coranique
        </h3>
        <span className="grow" />
        {payload.verdict.unresolved > 0 && payload.first_open ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="next-open"
            onClick={onNextOpen}
          >
            Aller au prochain non résolu
          </button>
        ) : null}
      </div>
      {slow && loading ? (
        <div className="ex-skel" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ) : (
        <ol
          className="ex-xlist"
          aria-labelledby="ex-list-h"
          aria-busy={loading}
          data-testid="ex-list"
          style={{ listStyle: "none", padding: 0, margin: "var(--sp-3) 0 0" }}
        >
          {items.length === 0 ? (
            <li className="ex-neutral-line">
              <XIcon name="check" />
              <p>Aucun passage dans ce filtre.</p>
            </li>
          ) : (
            items.map((item) => (
              <Row key={item.key} item={item} actions={actions} />
            ))
          )}
        </ol>
      )}
      {info.pages > 1 ? (
        <nav className="ex-pager" aria-label="Pagination des passages">
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page === 0}
            onClick={() => move(page - 1)}
          >
            <XIcon name="chev-l" size={16} />
            Précédents
          </button>
          <span data-testid="pager-text">
            Page {page + 1} sur {info.pages} · {info.total} passages
          </span>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            disabled={page >= info.pages - 1}
            onClick={() => move(page + 1)}
          >
            Suivants
            <XIcon name="chev-r" size={16} />
          </button>
        </nav>
      ) : (
        <p className="ex-pager muted" data-testid="pager-text">
          {info.total} sur {info.total} affichés
        </p>
      )}
      {payload.ineffective.total > 0 ? (
        <details className="ex-ineffective" data-testid="ineffective">
          <summary>
            Sans effet avec ces réglages · {payload.ineffective.total}
          </summary>
          <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>
            Ces passages sont incertains, mais choisir l’un ou l’autre ne change
            rien à ce que le fichier imprime avec les réglages actuels : ils ne
            bloquent pas l’export.
          </p>
          <ul className="ex-plain-list">
            {payload.ineffective.items.map((item) => (
              <li key={item.key}>
                <span className="mono">{clock(item.t[0])}</span> ·{" "}
                {TYPE_LABEL[item.type]}
                {item.candidates ? "" : ""} · {IMPACT_LABEL[item.impact]}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
