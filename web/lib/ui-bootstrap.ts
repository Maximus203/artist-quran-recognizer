import { DEFAULT_QURAN_FONT } from "./quran-fonts";
import { QURAN_FONT_IDS, QURAN_SIZE, UI_STORAGE_KEY } from "./ui-prefs";

/**
 * Script d'amorçage posé dans `<head>` : il lit les préférences AVANT le premier rendu pour poser le
 * thème, la police arabe et sa taille. Sans lui, la page s'afficherait d'abord dans le thème du
 * système puis « sauterait » (flash). Il ne dépend de rien et ne plante jamais : stockage bloqué ou
 * JSON invalide laissent les valeurs par défaut. Corps de fonction : `root` (l'élément <html>) et
 * `storage` (localStorage ou null) sont fournis par l'appelant.
 */
export const BOOTSTRAP_SCRIPT = `
var font = ${JSON.stringify(DEFAULT_QURAN_FONT)};
try {
  var raw = storage && storage.getItem(${JSON.stringify(UI_STORAGE_KEY)});
  var prefs = raw ? JSON.parse(raw) : null;
  if (prefs && typeof prefs === "object") {
    if (prefs.theme === "light" || prefs.theme === "dark") root.setAttribute("data-theme", prefs.theme);
    if (typeof prefs.font === "string" && ${JSON.stringify(QURAN_FONT_IDS)}.indexOf(prefs.font) >= 0) font = prefs.font;
    if (typeof prefs.size === "number" && isFinite(prefs.size)) {
      var size = Math.round(prefs.size / ${QURAN_SIZE.step}) * ${QURAN_SIZE.step};
      root.style.setProperty("--quran-size", Math.min(${QURAN_SIZE.max}, Math.max(${QURAN_SIZE.min}, size)) + "px");
    }
  }
} catch (e) {}
root.setAttribute("data-quran-font", font);
`;

/** Le script complet, prêt pour `dangerouslySetInnerHTML` (accès au stockage protégé). */
export const BOOTSTRAP_INLINE = `(function(){var root=document.documentElement,storage=null;try{storage=window.localStorage}catch(e){}${BOOTSTRAP_SCRIPT.replace(/\n\s*/g, " ")}})();`;
