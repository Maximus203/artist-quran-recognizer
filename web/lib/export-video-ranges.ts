/**
 * Plages d'une vidéo exportée : on n'exporte pas forcément toute la récitation. Chaque plage
 * (début, fin en secondes de l'audio) donne UNE vidéo ; plusieurs plages donnent plusieurs vidéos,
 * dans l'ordre donné. Pur : validé ici, utilisé par le formulaire, l'API et le rendu.
 */
export type ExportRange = { start: number; end: number };
/** Une plage peut porter un nom : il remplace l'intervalle dans le nom de son fichier. */
export type NamedRange = ExportRange & { name?: string };

export const MAX_RANGES = 50;
export const MAX_RANGE_NAME = 80;
export const MIN_RANGE_SECONDS = 0.5;

export type RangesResult =
  | { ok: true; ranges: NamedRange[] }
  | { ok: false; error: string };

const seconds = (value: number): string =>
  `${(Math.round(value * 10) / 10).toString().replace(".", ",")} s`;

/**
 * Vérifie les plages demandées pour un audio de `duration` secondes. Aucune plage = tout
 * l'audio (une seule vidéo). Une fin au-delà de la durée est ramenée à la durée.
 */
export function normalizeRanges(
  ranges: readonly NamedRange[] | undefined,
  duration: number,
): RangesResult {
  if (!ranges || ranges.length === 0)
    return { ok: true, ranges: [{ start: 0, end: duration }] };
  if (ranges.length > MAX_RANGES)
    return { ok: false, error: `${MAX_RANGES} plages au plus par export.` };
  const out: NamedRange[] = [];
  for (const [i, range] of ranges.entries()) {
    const label = `Plage ${i + 1}`;
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end))
      return { ok: false, error: `${label} : début ou fin illisible.` };
    if (range.start < 0)
      return { ok: false, error: `${label} : le début est négatif.` };
    if (range.start >= duration)
      return {
        ok: false,
        error: `${label} : commence à ${seconds(range.start)}, après la fin de l'audio (${seconds(duration)}).`,
      };
    const end = Math.min(range.end, duration);
    if (end - range.start < MIN_RANGE_SECONDS)
      return {
        ok: false,
        error: `${label} : trop courte (${seconds(MIN_RANGE_SECONDS)} au moins).`,
      };
    const name = range.name?.trim();
    out.push(
      name ? { start: range.start, end, name } : { start: range.start, end },
    );
  }
  return { ok: true, ranges: out };
}

/** Saisie « 83 », « 1:23 », « 1:23,5 » ou « 1:02:03 » → secondes, null si illisible. */
export function parseTimeInput(text: string): number | null {
  const cleaned = text.trim().replace(",", ".");
  if (!cleaned) return null;
  const parts = cleaned.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (const part of parts) {
    if (!/^\d+(\.\d+)?$/.test(part)) return null;
    total = total * 60 + Number(part);
  }
  return Number.isFinite(total) ? total : null;
}

/** Secondes → « 1:23,5 » (une décimale seulement si elle compte). */
export function formatTimeInput(value: number): string {
  const whole = Math.floor(value);
  const tenths = Math.round((value - whole) * 10);
  const carry = tenths === 10 ? 1 : 0;
  const total = whole + carry;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const base =
    h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
      : `${m}:${String(s).padStart(2, "0")}`;
  return tenths % 10 !== 0 ? `${base},${tenths % 10}` : base;
}

/** « 0m12s-0m40s » : sert de suffixe au nom du fichier d'une plage. */
export function rangeLabel(range: ExportRange): string {
  const part = (value: number): string =>
    `${Math.floor(value / 60)}m${String(Math.floor(value % 60)).padStart(2, "0")}s`;
  return `${part(range.start)}-${part(range.end)}`;
}
