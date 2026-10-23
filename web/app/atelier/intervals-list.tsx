"use client";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import {
  focusTarget,
  rowsToRender,
  scrollTopFor,
  visibleRows,
  type RowRange,
} from "@/lib/virtual-list";
import { useClock, useStoreValue } from "./hooks";
import type { PlayerState } from "./use-player";

const FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "verse", label: "Versets" },
  { id: "uncertain", label: "À revoir" },
  { id: "non_quran", label: "Formules" },
  { id: "abstention", label: "Abstentions" },
];

/** Hauteur de ligne avant mesure (le CSS la fixe : 44 px, 72 px sur petit écran). */
const DEFAULT_ROW_HEIGHT = 44;

/** Repère commun : seul ce petit libellé suit la position image par image. */
function CommonMark({ store }: { store: Store<PlayerState> }) {
  const time = useClock(store);
  return <>{formatTime(time)}</>;
}

/**
 * Une ligne. Mémorisée : changer la sélection ou la ligne en cours ne redessine que les deux lignes
 * concernées. La ligne est dans un élément `listitem` qui annonce la taille de la liste entière et la
 * position (`aria-setsize` / `aria-posinset`), car seules ~40 lignes existent dans le DOM.
 */
const Row = memo(function Row({
  item,
  index,
  pos,
  size,
  top,
  height,
  active,
  tabStop,
  onSelect,
  onFocusRow,
}: {
  item: Interval;
  index: number;
  pos: number;
  size: number;
  top: number;
  height: number;
  active: boolean;
  tabStop: boolean;
  onSelect: (index: number) => void;
  onFocusRow: (pos: number) => void;
}) {
  const formula =
    item.kind === "non_quran" ? formulaFromLabel(item.label) : null;
  return (
    <div
      role="listitem"
      aria-setsize={size}
      aria-posinset={pos + 1}
      className="vrow"
      style={{ top, height }}
    >
      <button
        type="button"
        className="irow segment"
        data-testid="interval-row"
        data-index={index}
        data-pos={pos}
        tabIndex={tabStop ? 0 : -1}
        aria-pressed={active}
        onFocus={() => onFocusRow(pos)}
        onClick={() => onSelect(index)}
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
    </div>
  );
});

type Props = {
  intervals: readonly Interval[];
  selectedIndex: number | null;
  follow: boolean;
  onUserScroll: () => void;
  onSelect: (index: number) => void;
  store: Store<PlayerState>;
};

/**
 * Liste des intervalles, virtualisée : un audio de 2 h en compte plus de 3 000. Seules les lignes
 * proches de la zone visible existent dans le DOM (hauteur de ligne fixe, positions absolues). Au
 * clavier : une seule ligne porte la tabulation (celle qu'on a focalisée, sinon la ligne choisie, sinon
 * la ligne en cours) et les flèches, Début, Fin, Page précédente/suivante déplacent le focus.
 */
export function IntervalsList(props: Props) {
  const [filter, setFilter] = useState("all");
  const list = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => filterIntervals(props.intervals, filter),
    [props.intervals, filter],
  );
  const positions = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach(({ index }, pos) => map.set(index, pos));
    return map;
  }, [rows]);
  const { follow, selectedIndex } = props;
  // Intervalle qui couvre la lecture : la liste ne se redessine que quand il change.
  const currentIndex = useStoreValue(props.store, (s) =>
    activeIndex(props.intervals, s.time),
  );

  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [range, setRange] = useState<RowRange>({ start: 0, end: 0 });
  // Ligne (position) qui porte la tabulation après une navigation ou un focus ; `null` = par défaut.
  const [focusPos, setFocusPos] = useState<number | null>(null);
  const pendingFocus = useRef<number | null>(null);
  const rowCount = rows.length;
  const hasRows = range.end > range.start;

  /** Fenêtre de lignes pour l'état de défilement actuel (même objet tant qu'elle ne change pas). */
  const refreshRange = useCallback(() => {
    const box = list.current;
    if (!box) return;
    const next = visibleRows(
      rowCount,
      rowHeight,
      box.scrollTop,
      box.clientHeight,
    );
    setRange((previous) =>
      previous.start === next.start && previous.end === next.end
        ? previous
        : next,
    );
  }, [rowCount, rowHeight]);

  // Mesure de la ligne (la hauteur change avec la largeur : une ou deux lignes de texte) et de la
  // zone visible. La première ligne du DOM sert d'étalon, toutes ont la même hauteur (CSS).
  useLayoutEffect(() => {
    const box = list.current;
    if (!box) return;
    const measure = () => {
      const first = box.querySelector<HTMLElement>(".irow");
      const height = first?.getBoundingClientRect().height;
      if (height && Math.abs(height - rowHeight) > 0.5) setRowHeight(height);
      refreshRange();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
    // `hasRows` : la première ligne n'existe qu'après le premier calcul de la fenêtre.
  }, [rowHeight, refreshRange, hasRows]);

  // Position par défaut de la tabulation : la ligne choisie, sinon celle qui joue, sinon la première.
  const defaultPos = useMemo(() => {
    const chosen =
      selectedIndex !== null ? positions.get(selectedIndex) : undefined;
    return chosen ?? positions.get(currentIndex) ?? 0;
  }, [positions, selectedIndex, currentIndex]);
  const tabStop = Math.min(
    Math.max(0, focusPos ?? defaultPos),
    Math.max(0, rowCount - 1),
  );
  const rendered = rowsToRender(range, rowCount > 0 ? tabStop : null, rowCount);

  // Suivi de la lecture : défile la liste elle-même, jamais la page (scrollIntoView ferait remonter
  // toute la colonne). Calcul sur les positions : la ligne n'a pas besoin d'exister dans le DOM.
  useEffect(() => {
    const box = list.current;
    const pos = positions.get(currentIndex);
    if (!follow || currentIndex < 0 || !box || pos === undefined) return;
    const target = scrollTopFor(
      pos,
      rowHeight,
      box.scrollTop,
      box.clientHeight,
    );
    if (target !== box.scrollTop) box.scrollTop = target;
  }, [currentIndex, follow, positions, rowHeight]);

  // Un changement de filtre repart du haut.
  useEffect(() => {
    if (list.current) list.current.scrollTop = 0;
    setFocusPos(null);
  }, [filter]);

  // Focus demandé par une touche de navigation : la ligne est garantie rendue (tabulation épinglée).
  useLayoutEffect(() => {
    const pos = pendingFocus.current;
    if (pos === null) return;
    const button = list.current?.querySelector<HTMLElement>(
      `.irow[data-pos="${pos}"]`,
    );
    if (!button) return;
    pendingFocus.current = null;
    button.focus({ preventScroll: true });
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(".irow");
    const box = list.current;
    if (!button || !box) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const pos = Number(button.dataset.pos);
    const pageRows = Math.max(1, Math.floor(box.clientHeight / rowHeight) - 1);
    const next = focusTarget(event.key, pos, rowCount, pageRows);
    if (next === null) return;
    event.preventDefault();
    props.onUserScroll();
    box.scrollTop = scrollTopFor(
      next,
      rowHeight,
      box.scrollTop,
      box.clientHeight,
    );
    pendingFocus.current = next;
    setFocusPos(next);
  };

  // Identité stable : les lignes mémorisées ne se redessinent pas quand le parent se redessine.
  const latestSelect = useRef(props.onSelect);
  latestSelect.current = props.onSelect;
  const select = useCallback(
    (index: number) => latestSelect.current(index),
    [],
  );

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
      <div
        ref={list}
        className="intervals-list"
        onWheel={props.onUserScroll}
        onScroll={refreshRange}
        onKeyDown={onKeyDown}
      >
        {rowCount === 0 ? (
          <p className="muted" style={{ padding: "var(--sp-4)" }}>
            Aucun intervalle à afficher.
          </p>
        ) : (
          <div
            className="vlist"
            role="list"
            aria-label="Liste des intervalles"
            style={{ height: rowCount * rowHeight }}
          >
            {rendered.map((pos) => {
              const { item, index } = rows[pos];
              const active =
                selectedIndex === index ||
                (selectedIndex === null && currentIndex === index);
              return (
                <Row
                  key={index}
                  item={item}
                  index={index}
                  pos={pos}
                  size={rowCount}
                  top={pos * rowHeight}
                  height={rowHeight}
                  active={active}
                  tabStop={pos === tabStop}
                  onSelect={select}
                  onFocusRow={setFocusPos}
                />
              );
            })}
          </div>
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
