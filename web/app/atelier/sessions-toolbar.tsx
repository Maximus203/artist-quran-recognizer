"use client";
import { useEffect, useRef, useState } from "react";
import type { Counts } from "@/lib/api-types";
import { engineLabel } from "@/lib/session-list";
import {
  ENGINE_FILTERS,
  type Scope,
  type Sort,
  type StateFilter,
} from "@/lib/session-query";
import {
  activeFilterCount,
  datePresetOf,
  localDay,
  presetRange,
  type DatePreset,
  type SessionsFilter,
} from "@/lib/sessions-filter";
import { Icon, type IconName } from "./icons";
import { useDismiss } from "./session-bits";

const SCOPES_UI: { id: Scope; label: string; icon?: IconName }[] = [
  { id: "all", label: "Toutes" },
  { id: "mine", label: "Mes sessions" },
  { id: "shared", label: "Partagées" },
  { id: "favorites", label: "Favoris", icon: "star" },
  { id: "archived", label: "Archivées", icon: "archive" },
];

const STATE_OPTIONS: { id: StateFilter; label: string }[] = [
  { id: "active", label: "En file (en cours ou en attente)" },
  { id: "done", label: "Terminées" },
  { id: "unread", label: "Non lues" },
  { id: "failed", label: "En échec" },
  { id: "cancelled", label: "Annulées" },
  { id: "ready", label: "Prêtes à analyser" },
];

const SORTS_UI: { id: Sort; label: string }[] = [
  { id: "recent", label: "Plus récentes" },
  { id: "oldest", label: "Plus anciennes" },
  { id: "name", label: "Nom (A → Z)" },
  { id: "duration", label: "Durée (la plus longue)" },
  { id: "size", label: "Taille (la plus lourde)" },
];

const PRESET_LABEL: Record<DatePreset, string> = {
  today: "Aujourd’hui",
  "7": "7 derniers jours",
  "30": "30 derniers jours",
  custom: "Période choisie",
};

/** Fenêtre flottante d'un filtre : bouton à pastille + panneau (feuille basse sur téléphone). */
function FilterPop({
  id,
  icon,
  label,
  value,
  active,
  children,
}: {
  id: string;
  icon: IconName;
  label: string;
  value: string;
  active: boolean;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), wrap, button);
  return (
    <div className="pop-wrap" ref={wrap}>
      <button
        ref={button}
        className="fbtn"
        type="button"
        data-testid={`filter-${id}`}
        data-on={active}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`fp-${id}`}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={icon} />
        {label} {value ? <span className="val">{value}</span> : null}
        <Icon name="chevron-d" />
      </button>
      {open ? (
        <div className="fpop" id={`fp-${id}`} role="dialog" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  filter: SessionsFilter;
  onChange: (patch: Partial<SessionsFilter>) => void;
  onClearAll: () => void;
  counts: Counts | null;
  /** Mode sélection (téléphone). */
  selectMode: boolean;
  onSelectMode: () => void;
};

export function SessionsToolbar({
  filter,
  onChange,
  onClearAll,
  counts,
  selectMode,
  onSelectMode,
}: Props) {
  // La recherche part 180 ms après la dernière frappe.
  const [text, setText] = useState(filter.q);
  const last = useRef(filter.q);
  useEffect(() => {
    if (filter.q !== last.current) {
      last.current = filter.q;
      setText(filter.q);
    }
  }, [filter.q]);
  useEffect(() => {
    if (text === last.current) return;
    const timer = setTimeout(() => {
      last.current = text;
      onChange({ q: text });
    }, 180);
    return () => clearTimeout(timer);
  }, [text, onChange]);

  const now = Date.now();
  const preset = datePresetOf(filter, now);
  const dateValue = preset ? PRESET_LABEL[preset] : "";
  const today = localDay(now);

  const toggle = <T extends string>(list: readonly T[], value: T): T[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  const chips: { key: string; text: string; remove: () => void }[] = [];
  if (filter.q.trim())
    chips.push({
      key: "q",
      text: `Recherche : ${filter.q.trim()}`,
      remove: () => onChange({ q: "" }),
    });
  for (const s of filter.states)
    chips.push({
      key: `s-${s}`,
      text: `État : ${STATE_OPTIONS.find((o) => o.id === s)?.label.split(" (")[0] ?? s}`,
      remove: () => onChange({ states: filter.states.filter((x) => x !== s) }),
    });
  for (const e of filter.engines)
    chips.push({
      key: `e-${e}`,
      text: `Moteur : ${engineLabel(e)}`,
      remove: () =>
        onChange({ engines: filter.engines.filter((x) => x !== e) }),
    });
  if (preset)
    chips.push({
      key: "d",
      text: `Date : ${PRESET_LABEL[preset]}${preset === "custom" ? ` (${filter.from || "…"} → ${filter.to || "…"})` : ""}`,
      remove: () => onChange({ from: "", to: "" }),
    });

  return (
    <div
      className="toolbar"
      role="search"
      aria-label="Rechercher et filtrer les sessions"
    >
      <div className="tb-row">
        <div className="search">
          <Icon name="search" />
          <input
            className="input"
            type="search"
            data-testid="search"
            placeholder="Rechercher…"
            aria-label="Rechercher une session par nom"
            autoComplete="off"
            enterKeyHint="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          {text ? (
            <button
              className="clear"
              type="button"
              aria-label="Effacer la recherche"
              onClick={() => {
                setText("");
                last.current = "";
                onChange({ q: "" });
              }}
            >
              <Icon name="x" />
            </button>
          ) : null}
        </div>
        <button
          className="btn btn--secondary only-narrow"
          type="button"
          data-testid="select-mode"
          aria-pressed={selectMode}
          onClick={onSelectMode}
        >
          {selectMode ? "Terminer" : "Sélectionner"}
        </button>
      </div>
      <div className="tb-row">
        <div className="seg-ctl" role="group" aria-label="Portée des sessions">
          {SCOPES_UI.map((scope) => (
            <button
              key={scope.id}
              type="button"
              data-testid={`scope-${scope.id}`}
              aria-pressed={filter.scope === scope.id}
              onClick={() => onChange({ scope: scope.id })}
            >
              {scope.icon ? <Icon name={scope.icon} /> : null}
              {scope.label}{" "}
              <span className="n">{counts ? counts.scopes[scope.id] : ""}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="fbar">
        <FilterPop
          id="state"
          icon="sliders"
          label="État"
          active={filter.states.length > 0}
          value={
            filter.states.length === 0
              ? ""
              : filter.states.length === 1
                ? (STATE_OPTIONS.find(
                    (o) => o.id === filter.states[0],
                  )?.label.split(" (")[0] ?? "")
                : `${filter.states.length} choisis`
          }
        >
          {(close) => (
            <>
              <p className="eyebrow menu-label" style={{ padding: "4px 8px" }}>
                État
              </p>
              {STATE_OPTIONS.map((option) => (
                <label className="check" key={option.id}>
                  <input
                    type="checkbox"
                    checked={filter.states.includes(option.id)}
                    onChange={() =>
                      onChange({ states: toggle(filter.states, option.id) })
                    }
                  />
                  {option.label}
                  <span className="n">
                    {counts ? counts.states[option.id] : ""}
                  </span>
                </label>
              ))}
              <div className="foot-row">
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => onChange({ states: [] })}
                >
                  Effacer
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  type="button"
                  onClick={close}
                >
                  Fermer
                </button>
              </div>
            </>
          )}
        </FilterPop>
        <FilterPop
          id="engine"
          icon="wave"
          label="Moteur"
          active={filter.engines.length > 0}
          value={
            filter.engines.length === 0
              ? ""
              : filter.engines.length === 1
                ? engineLabel(filter.engines[0])
                : `${filter.engines.length} choisis`
          }
        >
          {(close) => (
            <>
              <p className="eyebrow menu-label" style={{ padding: "4px 8px" }}>
                Moteur d’analyse
              </p>
              {ENGINE_FILTERS.map((engine) => (
                <label className="check" key={engine}>
                  <input
                    type="checkbox"
                    checked={filter.engines.includes(engine)}
                    onChange={() =>
                      onChange({ engines: toggle(filter.engines, engine) })
                    }
                  />
                  {engineLabel(engine)}
                </label>
              ))}
              <div className="foot-row">
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => onChange({ engines: [] })}
                >
                  Effacer
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  type="button"
                  onClick={close}
                >
                  Fermer
                </button>
              </div>
            </>
          )}
        </FilterPop>
        <FilterPop
          id="date"
          icon="calendar"
          label="Date"
          active={preset !== null}
          value={dateValue}
        >
          {(close) => (
            <>
              <p className="eyebrow menu-label" style={{ padding: "4px 8px" }}>
                Période
              </p>
              <div
                className="presets"
                role="group"
                aria-label="Raccourcis de période"
              >
                {(["today", "7", "30"] as const).map((p) => (
                  <button
                    key={p}
                    className="chip"
                    type="button"
                    data-testid={`preset-${p}`}
                    aria-pressed={preset === p}
                    onClick={() => onChange(presetRange(p, now))}
                  >
                    {p === "today"
                      ? "Aujourd’hui"
                      : p === "7"
                        ? "7 jours"
                        : "30 jours"}
                  </button>
                ))}
                <button
                  className="chip"
                  type="button"
                  aria-pressed={preset === "custom"}
                  onClick={() =>
                    onChange({
                      from: filter.from || today,
                      to: filter.to || today,
                    })
                  }
                >
                  Personnalisée
                </button>
              </div>
              {preset ? (
                <div className="range">
                  <label className="field">
                    Du
                    <input
                      className="input"
                      type="date"
                      max={today}
                      value={filter.from}
                      data-testid="date-from"
                      onChange={(event) =>
                        onChange({ from: event.target.value })
                      }
                    />
                  </label>
                  <label className="field">
                    Au
                    <input
                      className="input"
                      type="date"
                      max={today}
                      min={filter.from || undefined}
                      value={filter.to}
                      data-testid="date-to"
                      onChange={(event) => onChange({ to: event.target.value })}
                    />
                  </label>
                </div>
              ) : null}
              <div className="foot-row">
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => onChange({ from: "", to: "" })}
                >
                  Effacer
                </button>
                <button
                  className="btn btn--secondary btn--sm"
                  type="button"
                  onClick={close}
                >
                  Appliquer
                </button>
              </div>
            </>
          )}
        </FilterPop>
      </div>
      {chips.length > 0 ? (
        <div className="afilters" aria-label="Filtres actifs">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="chip chip--x"
              aria-label={`Retirer le filtre : ${chip.text}`}
              onClick={chip.remove}
            >
              {chip.text}
              <Icon name="x" />
            </button>
          ))}
          {activeFilterCount(filter) >= 2 ? (
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="clear-all"
              onClick={onClearAll}
            >
              Tout effacer
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const SORT_OPTIONS = SORTS_UI;
