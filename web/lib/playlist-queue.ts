/**
 * File de lecture d'une playlist : fonctions PURES (aucun accès au lecteur), pour que le comportement d'un vrai
 * lecteur audio (suivant, précédent, répétition, aléatoire) se teste sans navigateur. Le lecteur de la page
 * `/playlists/<id>` ne fait que brancher l'élément `<audio>` sur ces fonctions.
 */
export type RepeatMode = "off" | "all" | "one";
export type Queue = {
  /** Les audios dans l'ordre de la playlist. */
  readonly natural: readonly string[];
  /** Ordre de lecture : celui de la playlist, ou un tour mélangé. */
  readonly order: readonly string[];
  /** Position de l'audio courant dans `order`. */
  readonly cursor: number;
  readonly repeat: RepeatMode;
  readonly shuffle: boolean;
};

/** Au-delà de ce temps d'écoute, « précédent » recommence l'audio au lieu de reculer (comme les lecteurs usuels). */
export const PREV_RESTART_S = 3;

type Rand = () => number;

/** Mélange de Fisher-Yates ; `first` (s'il existe) reste en tête. */
function shuffled(
  ids: readonly string[],
  first: string | null,
  rand: Rand,
): string[] {
  const rest = ids.filter((id) => id !== first);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return first !== null && ids.includes(first) ? [first, ...rest] : rest;
}

export function createQueue(
  ids: readonly string[],
  options: {
    startId?: string;
    repeat?: RepeatMode;
    shuffle?: boolean;
    rand?: Rand;
  } = {},
): Queue {
  const start =
    options.startId !== undefined && ids.includes(options.startId)
      ? options.startId
      : (ids[0] ?? null);
  const shuffle = options.shuffle ?? false;
  const order = shuffle
    ? shuffled(ids, start, options.rand ?? Math.random)
    : ids;
  const cursor = start === null ? 0 : Math.max(0, order.indexOf(start));
  return {
    natural: ids,
    order,
    cursor,
    repeat: options.repeat ?? "off",
    shuffle,
  };
}

export const currentId = (q: Queue): string | null => q.order[q.cursor] ?? null;
export const playOrder = (q: Queue): string[] => [...q.order];

export const nextRepeat = (mode: RepeatMode): RepeatMode =>
  mode === "off" ? "all" : mode === "all" ? "one" : "off";

export const withRepeat = (q: Queue, repeat: RepeatMode): Queue => ({
  ...q,
  repeat,
});

/** Active ou coupe l'aléatoire sans changer d'audio : l'audio courant reste le courant. */
export function withShuffle(
  q: Queue,
  on: boolean,
  rand: Rand = Math.random,
): Queue {
  if (on === q.shuffle) return q;
  const current = currentId(q);
  if (on) {
    const order = shuffled(q.natural, current, rand);
    return { ...q, order, cursor: 0, shuffle: true };
  }
  const cursor = current === null ? 0 : Math.max(0, q.natural.indexOf(current));
  return { ...q, order: q.natural, cursor, shuffle: false };
}

/** Aller directement à un audio de la liste (inconnu : la file ne bouge pas). */
export function jumpTo(q: Queue, id: string): Queue {
  const cursor = q.order.indexOf(id);
  return cursor < 0 ? q : { ...q, cursor };
}

/** Nouveau tour (boucle de la playlist) : mélangé si besoin, sans rejouer d'abord l'audio qui vient de finir. */
function wrapped(q: Queue, rand: Rand): Queue {
  if (!q.shuffle) return { ...q, cursor: 0 };
  const last = currentId(q);
  const order = shuffled(q.natural, null, rand);
  if (order.length > 1 && order[0] === last)
    [order[0], order[1]] = [order[1], order[0]];
  return { ...q, order, cursor: 0 };
}

/** Un audio vient de se terminer : quoi jouer ensuite ? `play: false` = la playlist est finie. */
export function onEnded(
  q: Queue,
  rand: Rand = Math.random,
): { queue: Queue; play: boolean } {
  if (q.order.length === 0) return { queue: q, play: false };
  if (q.repeat === "one") return { queue: q, play: true };
  if (q.cursor + 1 < q.order.length)
    return { queue: { ...q, cursor: q.cursor + 1 }, play: true };
  if (q.repeat === "all") return { queue: wrapped(q, rand), play: true };
  return { queue: q, play: false };
}

export type Skip = { queue: Queue; action: "move" | "restart" | "none" };

/** « Suivant » à la main : ne s'arrête pas sur l'audio répété, et ne rebondit pas au bout sans boucle de la playlist. */
export function skipNext(q: Queue, rand: Rand = Math.random): Skip {
  if (q.order.length === 0) return { queue: q, action: "none" };
  if (q.cursor + 1 < q.order.length)
    return { queue: { ...q, cursor: q.cursor + 1 }, action: "move" };
  if (q.repeat === "all") return { queue: wrapped(q, rand), action: "move" };
  return { queue: q, action: "none" };
}

/** « Précédent » : recommence l'audio après quelques secondes d'écoute, sinon recule (au début : recommence, ou boucle). */
export function skipPrev(q: Queue, positionS: number): Skip {
  if (q.order.length === 0) return { queue: q, action: "none" };
  if (positionS > PREV_RESTART_S) return { queue: q, action: "restart" };
  if (q.cursor > 0)
    return { queue: { ...q, cursor: q.cursor - 1 }, action: "move" };
  if (q.repeat === "all")
    return { queue: { ...q, cursor: q.order.length - 1 }, action: "move" };
  return { queue: q, action: "restart" };
}
