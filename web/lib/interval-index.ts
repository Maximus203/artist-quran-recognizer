/**
 * Index temporel des intervalles du moteur : « quel intervalle couvre cet instant ? » et « lesquels
 * touchent cette fenêtre ? » en O(log n), au lieu d'un parcours de tous les intervalles à chaque image
 * de lecture ou à chaque redessin de la timeline (3 160 intervalles pour 2 h d'audio).
 *
 * Aucune hypothèse d'ordre ni de non-chevauchement : l'index trie les débuts et garde, pour chaque
 * position, la plus grande fin vue jusque-là (une fin maximale qui ne dépasse pas l'instant prouve
 * qu'aucun intervalle plus tôt ne le couvre). Le résultat est celui de la recherche linéaire
 * `findIndex` / `filter` qu'il remplace (premier intervalle du tableau qui couvre, ordre du tableau).
 */
export type TimedItem = { t: readonly [number, number] | null };

export type TimeIndex = {
  /** Indices d'origine, triés par début croissant (égalité : ordre du tableau). */
  order: Int32Array;
  starts: Float64Array;
  ends: Float64Array;
  /** `maxEnd[p]` = plus grande fin parmi les positions 0..p. */
  maxEnd: Float64Array;
};

export function buildTimeIndex(items: readonly TimedItem[]): TimeIndex {
  const timed: number[] = [];
  items.forEach((item, n) => {
    if (item.t) timed.push(n);
  });
  timed.sort((x, y) => {
    const dx = (items[x].t as readonly [number, number])[0];
    const dy = (items[y].t as readonly [number, number])[0];
    return dx - dy || x - y;
  });
  const count = timed.length;
  const order = Int32Array.from(timed);
  const starts = new Float64Array(count);
  const ends = new Float64Array(count);
  const maxEnd = new Float64Array(count);
  let top = -Infinity;
  for (let p = 0; p < count; p++) {
    const [a, b] = items[order[p]].t as readonly [number, number];
    starts[p] = a;
    ends[p] = b;
    top = Math.max(top, b);
    maxEnd[p] = top;
  }
  return { order, starts, ends, maxEnd };
}

const cache = new WeakMap<object, TimeIndex>();

/** Index mémorisé par tableau d'intervalles : calculé une seule fois par résultat chargé. */
export function timeIndexOf(items: readonly TimedItem[]): TimeIndex {
  let known = cache.get(items);
  if (!known) {
    known = buildTimeIndex(items);
    cache.set(items, known);
  }
  return known;
}

/** Dernière position dont le début est strictement avant `limit` (inclus si `inclusive`), -1 sinon. */
function lastStartBefore(
  index: TimeIndex,
  limit: number,
  inclusive: boolean,
): number {
  let low = 0;
  let high = index.starts.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const start = index.starts[mid];
    if (inclusive ? start <= limit : start < limit) {
      found = mid;
      low = mid + 1;
    } else high = mid - 1;
  }
  return found;
}

/** Indice d'origine de l'intervalle qui couvre `time` (début inclus, fin exclue), -1 sinon. */
export function indexAt(index: TimeIndex, time: number): number {
  if (!Number.isFinite(time)) return -1;
  let best = -1;
  for (let p = lastStartBefore(index, time, true); p >= 0; p--) {
    if (index.maxEnd[p] <= time) break;
    if (index.ends[p] > time && (best < 0 || index.order[p] < best))
      best = index.order[p];
  }
  return best;
}

/**
 * Intervalle qui couvre `time`, sinon le plus proche : un clic sur un bloc de segments fondus peut
 * tomber dans un vide entre deux d'entre eux, et doit quand même désigner un intervalle.
 */
export function nearestIndex(index: TimeIndex, time: number): number {
  if (!Number.isFinite(time) || index.starts.length === 0) return -1;
  const covering = indexAt(index, time);
  if (covering >= 0) return covering;
  const before = lastStartBefore(index, time, true);
  const distance = (p: number) =>
    Math.max(0, index.starts[p] - time, time - index.ends[p]);
  // Avant le début de `time` : le plus tardif en fin parmi les derniers débuts ; après : le suivant.
  let best = -1;
  let bestDistance = Infinity;
  for (const p of [before, before + 1]) {
    if (p < 0 || p >= index.starts.length) continue;
    const d = distance(p);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  // Un grand intervalle plus ancien peut finir plus près que le dernier début : on remonte tant que la
  // fin maximale vue peut encore battre le meilleur candidat.
  for (
    let p = before - 1;
    p >= 0 && time - index.maxEnd[p] < bestDistance;
    p--
  ) {
    const d = distance(p);
    if (d < bestDistance) {
      bestDistance = d;
      best = p;
    }
  }
  return best < 0 ? -1 : index.order[best];
}

/** Indices d'origine (ordre du tableau) des intervalles qui touchent ]a, b[ : les bords seuls exclus. */
export function indicesOverlapping(
  index: TimeIndex,
  a: number,
  b: number,
): number[] {
  if (!Number.isFinite(a) || !Number.isFinite(b) || !(b > a)) return [];
  const found: number[] = [];
  for (let p = lastStartBefore(index, b, false); p >= 0; p--) {
    if (index.maxEnd[p] <= a) break;
    if (index.ends[p] > a) found.push(index.order[p]);
  }
  return found.sort((x, y) => x - y);
}
