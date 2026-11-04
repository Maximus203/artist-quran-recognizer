/**
 * La place du lecteur réduit. Il est posé en bas de toute page connectée (`position: fixed`) : tant qu'il est là,
 * la racine du document porte `data-mini-player`, et `tokens.css` passe `--mini-reserve` de 0 à sa hauteur.
 * Toute page qui prend la hauteur de l'écran retire cette réserve de sa hauteur (un seul endroit à connaître,
 * aucune rustine par écran) ; `mini-reserve.test.ts` garde que plus aucune hauteur « plein écran » ne l'oublie.
 */

/** Le nom du drapeau, tel que `dataset` le range (`data-mini-player`). */
export const MINI_PLAYER_FLAG = "miniPlayer";

type Root = { dataset: Record<string, string | undefined> };

/** Combien de lecteurs sont annoncés sur chaque racine (un seul en pratique ; le compte évite un retrait trop tôt). */
const announced = new WeakMap<object, number>();

/** Annonce le lecteur réduit sur `root` ; renvoie le retrait (sans effet s'il est appelé une seconde fois). */
export function announceMiniPlayer(root: Root): () => void {
  announced.set(root, (announced.get(root) ?? 0) + 1);
  root.dataset[MINI_PLAYER_FLAG] = "";
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (announced.get(root) ?? 1) - 1;
    announced.set(root, left);
    if (left <= 0) delete root.dataset[MINI_PLAYER_FLAG];
  };
}
