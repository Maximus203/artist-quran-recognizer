/**
 * Réécrire l'adresse de la page SANS effacer l'état de l'entrée d'historique. Next range dans cet état (`__NA`, l'arbre
 * de la page) ce qu'il faut pour rejouer l'écran quand on appuie sur Retour ; `replaceState(null, …)` l'efface, et
 * Retour change alors l'adresse sans changer l'écran (recette QA 2, N2). Toute réécriture d'adresse passe donc ici.
 */

/** Ce que la fonction attend de `window` : l'historique, lu et réécrit. */
export type UrlWindow = {
  history: {
    readonly state: unknown;
    replaceState: (data: unknown, unused: string, url?: string | null) => void;
  };
};

/** Remplace l'adresse de l'entrée courante (ni nouvelle entrée, ni état perdu). */
export function replaceUrl(
  url: string,
  win: UrlWindow | null = typeof window === "undefined" ? null : window,
): void {
  if (!win) return;
  win.history.replaceState(win.history.state, "", url);
}
