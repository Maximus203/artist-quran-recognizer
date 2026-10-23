import type { ReadinessItem } from "./export-types";

export type Neighbours = {
  /** Rang du passage parmi les non résolus (à partir de 1), `null` s'il est déjà résolu. */
  position: number | null;
  open: number;
  prev: string | null;
  next: string | null;
};

/** Le passage précédent et le suivant NON RÉSOLUS (par le temps), et le rang du passage courant. */
export function neighbours(
  items: readonly ReadinessItem[],
  key: string,
): Neighbours {
  const open = items.filter((i) => i.state === "open");
  const at = items.findIndex((i) => i.key === key);
  const current = at >= 0 ? items[at] : null;
  const before = items
    .slice(0, Math.max(at, 0))
    .filter((i) => i.state === "open");
  const after = items.slice(at + 1).filter((i) => i.state === "open");
  return {
    position: current?.state === "open" ? before.length + 1 : null,
    open: open.length,
    prev: before.at(-1)?.key ?? null,
    next: after[0]?.key ?? null,
  };
}
