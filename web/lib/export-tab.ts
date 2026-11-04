/**
 * Les onglets de la page « Exporter » et leur mémoire dans l'adresse. Fonctions PURES, sans DOM.
 *
 * Arriver par le bouton « Exporter » (adresse nue) ouvre sur la porte « Vérifier » : c'est voulu, la
 * vérification passe avant les livrables. Changer d'onglet écrit `?onglet=…` dans l'adresse SANS ajouter
 * d'entrée à l'historique : recharger la page ramène sur le même onglet, et le bouton Retour ne passe pas
 * par chaque onglet visité.
 */

export const EXPORT_TABS = ["verifier", "soustitres", "video"] as const;
export type ExportTab = (typeof EXPORT_TABS)[number];

/** L'onglet d'ouverture quand rien d'autre n'est demandé. */
export const DEFAULT_EXPORT_TAB: ExportTab = "verifier";

export const EXPORT_TAB_PARAM = "onglet";

const isExportTab = (value: unknown): value is ExportTab =>
  typeof value === "string" &&
  (EXPORT_TABS as readonly string[]).includes(value);

/**
 * L'onglet à ouvrir. `raw` est la valeur de `?onglet=` telle que Next la donne (texte, liste ou absente) :
 * tout ce qui n'est pas exactement un onglet connu retombe sur la porte. Le récitant n'exporte que la vidéo.
 */
export function resolveExportTab(
  raw: string | readonly string[] | null | undefined,
  recitant: boolean,
): ExportTab {
  if (recitant) return "video";
  return isExportTab(raw) ? raw : DEFAULT_EXPORT_TAB;
}

/** L'adresse à écrire pour `tab` : on garde le chemin et les autres paramètres ; la porte est l'adresse nue. */
export function withExportTab(
  pathname: string,
  search: string,
  tab: ExportTab,
): string {
  const params = new URLSearchParams(search);
  params.delete(EXPORT_TAB_PARAM);
  if (tab !== DEFAULT_EXPORT_TAB) params.set(EXPORT_TAB_PARAM, tab);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
