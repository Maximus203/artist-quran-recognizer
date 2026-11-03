import { PREFS_CACHE_KEY } from "./prefs-sync";

/**
 * Script d'amorçage posé dans `<head>` des pages SANS compte connecté (connexion, inscription) :
 * il reprend le thème mémorisé par le navigateur (cache `aqr.prefs.v2`) AVANT le premier rendu,
 * pour que la page ne s'affiche pas dans le thème du système puis « saute ». Pour une page
 * connectée, c'est le serveur qui pose thème, police et taille dans le HTML (les préférences du
 * compte font foi) : ce script n'y est pas servi. Il ne dépend de rien et ne plante jamais :
 * stockage bloqué ou JSON invalide laissent le thème du système. Corps de fonction : `root`
 * (l'élément <html>) et `storage` (localStorage ou null) sont fournis par l'appelant.
 */
export const BOOTSTRAP_SCRIPT = `
try {
  var raw = storage && storage.getItem(${JSON.stringify(PREFS_CACHE_KEY)});
  var cache = raw ? JSON.parse(raw) : null;
  var theme = cache && cache.prefs && cache.prefs.theme;
  if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
} catch (e) {}
`;

/** Le script complet, prêt pour `dangerouslySetInnerHTML` (accès au stockage protégé). */
export const BOOTSTRAP_INLINE = `(function(){var root=document.documentElement,storage=null;try{storage=window.localStorage}catch(e){}${BOOTSTRAP_SCRIPT.replace(/\n\s*/g, " ")}})();`;
