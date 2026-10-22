"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatTime, type Interval } from "@/lib/recognition";
import { formatTenths } from "@/lib/format";
import {
  activeIndex,
  filterIntervals,
  intervalLabel,
  intervalStateLabel,
  intervalStyle,
} from "@/lib/passage";
import { formulaFromLabel } from "@/lib/formulas";
import type { Store } from "@/lib/mini-store";
import { useStoreValue } from "./hooks";
import type { PlayerState } from "./use-player";

const FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "verse", label: "Versets" },
  { id: "uncertain", label: "À revoir" },
  { id: "non_quran", label: "Formules" },
  { id: "abstention", label: "Abstentions" },
];

/** Repère commun : seul ce petit libellé suit la position image par image. */
function CommonMark({ store }: { store: Store<PlayerState> }) {
  const time = useStoreValue(store, (s) => s.time);
  return <>{formatTime(time)}</>;
}

type Props = {
  intervals: readonly Interval[];
  selectedIndex: number | null;
  follow: boolean;
  onUserScroll: () => void;
  onSelect: (index: number) => void;
  store: Store<PlayerState>;
};

export function IntervalsList(props: Props) {
  const [filter, setFilter] = useState("all");
  const list = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => filterIntervals(props.intervals, filter),
    [props.intervals, filter],
  );
  const { follow } = props;
  // Intervalle qui couvre la lecture : la liste ne se redessine que quand il change.
  const currentIndex = useStoreValue(props.store, (s) =>
    activeIndex(props.intervals, s.time),
  );
  useEffect(() => {
    // Défile la liste elle-même, jamais la page : scrollIntoView ferait remonter toute la colonne.
    const box = list.current;
    const row = box?.querySelector<HTMLElement>(
      `[data-index="${currentIndex}"]`,
    );
    if (!follow || currentIndex < 0 || !box || !row) return;
    const b = box.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop -= b.top - r.top;
    else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
  }, [currentIndex, follow]);
  return (
    <section
      className="card o-intervals"
      aria-label="Intervalles"
      data-testid="intervals"
    >
      <div className="card-pad" style={{ paddingBottom: "var(--sp-3)" }}>
        <div className="sec-title">
          <h2>Intervalles</h2>
          <span className="muted mono" style={{ fontSize: "var(--fs-sm)" }}>
            {props.intervals.length} · repère commun{" "}
            <CommonMark store={props.store} />
          </span>
        </div>
        <div
          className="seg-filters"
          role="group"
          aria-label="Filtrer les intervalles"
        >
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              className="chip"
              data-testid={`interval-filter-${f.id}`}
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div ref={list} className="intervals-list" onWheel={props.onUserScroll}>
        {rows.length === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-4)" }}>
            Aucun intervalle à afficher.
          </p>
        ) : (
          rows.map(({ item, index }) => {
            const formula =
              item.kind === "non_quran" ? formulaFromLabel(item.label) : null;
            const active =
              props.selectedIndex === index ||
              (props.selectedIndex === null && currentIndex === index);
            return (
              <button
                key={index}
                type="button"
                className="irow segment"
                data-testid="interval-row"
                data-index={index}
                aria-pressed={active}
                onClick={() => props.onSelect(index)}
              >
                <span className="tm">
                  {item.t ? formatTenths(item.t[0]) : "Sans temps"}
                </span>
                <span className="ti">
                  {intervalLabel(item)}
                  {formula ? (
                    <span className="ar" lang="ar" dir="rtl">
                      {formula.label}
                    </span>
                  ) : null}
                </span>
                <span className="st">
                  <span className={`sw s-${intervalStyle(item)}`} />
                  {intervalStateLabel(item)}
                </span>
              </button>
            );
          })
        )}
        {props.intervals.some((i) => i.t === null) ? (
          <p className="muted" style={{ padding: "var(--sp-3) var(--sp-4)" }}>
            Les éléments « Sans temps » ne déplacent pas le lecteur.
          </p>
        ) : null}
      </div>
    </section>
  );
}
