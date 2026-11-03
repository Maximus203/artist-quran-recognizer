import {
  DEFAULT_EXPORT_OPTIONS,
  exportOptionsSchema,
  type ExportOptions,
} from "./export-options";

/**
 * Les réglages d'export mémorisés dans le navigateur (`aqr.ui.v1.export`) : un confort par appareil,
 * jamais un état qui compte. Tout accès au stockage est protégé (fenêtre privée, stockage bloqué) et
 * une valeur illisible ou périmée retombe sur les défauts. Le forçage (`allow_unresolved`) et la
 * politique ne se mémorisent pas : forcer est un choix à refaire chaque fois, en connaissance de cause.
 */
export const EXPORT_PREFS_KEY = "aqr.ui.v1.export";

type Reader = Pick<Storage, "getItem">;
type Writer = Pick<Storage, "setItem">;

function browserStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadExportOptions(
  storage: Reader | null = browserStorage(),
): ExportOptions {
  try {
    const raw = storage?.getItem(EXPORT_PREFS_KEY);
    if (!raw) return DEFAULT_EXPORT_OPTIONS;
    const parsed = exportOptionsSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return DEFAULT_EXPORT_OPTIONS;
    const merged = { ...DEFAULT_EXPORT_OPTIONS, ...parsed.data };
    if (merged.max_s < merged.min_s) return DEFAULT_EXPORT_OPTIONS;
    return { ...merged, allow_unresolved: false, policy: "omit" };
  } catch {
    return DEFAULT_EXPORT_OPTIONS;
  }
}

export function saveExportOptions(
  options: ExportOptions,
  storage: Writer | null = browserStorage(),
): void {
  try {
    const { allow_unresolved: _a, policy: _p, ...kept } = options;
    storage?.setItem(EXPORT_PREFS_KEY, JSON.stringify(kept));
  } catch {
    /* stockage plein ou bloqué : le réglage vaut pour cette page seulement */
  }
}
