/**
 * « Retour » ferme d'abord ce qui est ouvert (convention mobile) : une feuille de réglages, une fenêtre. Pendant
 * qu'elle est ouverte, on ajoute UNE entrée à l'historique du navigateur ; le bouton Retour la retire (et la
 * feuille se ferme) au lieu de quitter la page. Fermer la feuille autrement (« Terminé », Échap) retire cette
 * entrée à son tour, pour que Retour ne tombe pas sur une page « vide ».
 *
 * Fonction PURE vis-à-vis du DOM : elle ne touche que la fenêtre qu'on lui donne (testée avec une fausse).
 */

/** Ce que la fonction attend de `window` : l'historique et l'événement `popstate`. */
export type BackWindow = {
  history: {
    readonly state: unknown;
    pushState: (data: unknown, unused: string, url?: string | null) => void;
    back: () => void;
  };
  addEventListener: (
    type: "popstate",
    listener: (event: { state: unknown }) => void,
  ) => void;
  removeEventListener: (
    type: "popstate",
    listener: (event: { state: unknown }) => void,
  ) => void;
};

/** La marque posée dans l'état de l'entrée ajoutée (l'état de l'application, lui, est conservé tel quel). */
const MARK = "aqrBackClose";

let counter = 0;
/** Un retrait différé, par fenêtre : un démontage suivi d'un remontage immédiat (mode strict) réutilise l'entrée. */
const pending = new WeakMap<
  object,
  { token: string; timer: ReturnType<typeof setTimeout> }
>();

const tokenOf = (state: unknown): string | null => {
  if (state && typeof state === "object" && MARK in state) {
    const value = (state as Record<string, unknown>)[MARK];
    return typeof value === "string" ? value : null;
  }
  return null;
};

/**
 * Prend la main sur le bouton Retour tant que quelque chose est ouvert.
 * `onBack` est appelé quand la personne appuie sur Retour (l'entrée ajoutée a alors disparu).
 * Renvoie `release`, à appeler quand la chose se ferme par un autre chemin ; sans effet la seconde fois.
 */
export function bindBackClose(
  win: BackWindow | null,
  onBack: () => void,
): () => void {
  if (!win) return () => undefined;

  let token: string;
  const waiting = pending.get(win);
  if (waiting) {
    // Démonté puis remonté dans le même instant : l'entrée est encore là, on la reprend.
    clearTimeout(waiting.timer);
    pending.delete(win);
    token = waiting.token;
  } else {
    counter += 1;
    token = `bc${counter}`;
    const current = win.history.state;
    const base =
      current && typeof current === "object"
        ? (current as Record<string, unknown>)
        : {};
    win.history.pushState({ ...base, [MARK]: token }, "");
  }

  let active = true;
  const onPop = () => {
    // Notre entrée n'est plus la courante : on est revenu en arrière, la feuille doit se fermer.
    if (!active || tokenOf(win.history.state) === token) return;
    active = false;
    win.removeEventListener("popstate", onPop);
    onBack();
  };
  win.addEventListener("popstate", onPop);

  return () => {
    if (!active) return;
    active = false;
    win.removeEventListener("popstate", onPop);
    const timer = setTimeout(() => {
      pending.delete(win);
      // Seulement si notre entrée est encore la courante : après une navigation, reculer défairait ce pas.
      if (tokenOf(win.history.state) === token) win.history.back();
    }, 0);
    pending.set(win, { token, timer });
  };
}
