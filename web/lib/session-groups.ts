import type { Sort } from "./session-query";

/**
 * Regroupement par date des sessions de la page « Sessions ». Pur : l'ordre vient du serveur et
 * n'est jamais modifié ; on ne fait que couper la liste en groupes consécutifs. Les groupes ne
 * s'appliquent qu'aux tris chronologiques (récentes, anciennes) : trié par nom, durée ou taille,
 * des titres de date seraient trompeurs.
 */
export type DateGroup<T> = { key: string; label: string | null; items: T[] };

const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const dayStart = (time: number): number => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Libellé de groupe d'une date (cadre : jour local du navigateur). */
export function dateGroupOf(
  iso: string,
  now: number,
): { key: string; label: string } {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return { key: "unknown", label: "Date inconnue" };
  const days = Math.round((dayStart(now) - dayStart(at)) / 86_400_000);
  if (days <= 0) return { key: "today", label: "Aujourd’hui" };
  if (days === 1) return { key: "yesterday", label: "Hier" };
  if (days < 7) return { key: "week", label: "Cette semaine" };
  const date = new Date(at);
  return {
    key: `m-${date.getFullYear()}-${date.getMonth()}`,
    label: `${MONTHS[date.getMonth()]} ${date.getFullYear()}`,
  };
}

export function groupByDate<T extends { created_at: string }>(
  items: readonly T[],
  sort: Sort,
  now: number,
): DateGroup<T>[] {
  if (items.length === 0) return [];
  if (sort !== "recent" && sort !== "oldest")
    return [{ key: "all", label: null, items: [...items] }];
  const groups: DateGroup<T>[] = [];
  for (const item of items) {
    const { key, label } = dateGroupOf(item.created_at, now);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label, items: [item] });
  }
  return groups;
}

/** Ajoute une page à la suite de la liste ; une ligne déjà présente est remplacée en place. */
export function mergePages<T extends { id: string }>(
  current: readonly T[],
  next: readonly T[],
): T[] {
  const incoming = new Map(next.map((item) => [item.id, item]));
  const merged = current.map((item) => incoming.get(item.id) ?? item);
  const known = new Set(current.map((item) => item.id));
  for (const item of next) if (!known.has(item.id)) merged.push(item);
  return merged;
}
