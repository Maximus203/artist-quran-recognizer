/**
 * Écritures arabes : lettres et signes (0600–06FF), supplément (0750–077F), étendu-A (08A0–08FF),
 * formes de présentation A et B (FB50–FDFF, FE70–FEFF). Une seule définition pour le journal (qui ne
 * doit jamais écrire de texte coranique) et pour la lecture d'un résultat (champs libres, jamais de
 * faux arabe à l'écran).
 */
const LETTERS =
  "\\u0600-\\u06FF\\u0750-\\u077F\\u08A0-\\u08FF\\uFB50-\\uFDFF\\uFE70-\\uFEFF";
/** Une phrase arabe entière (mots séparés par des espaces) est UNE suite à masquer, sans espace final. */
const ARABIC_RUN = new RegExp(
  `[${LETTERS}](?:[${LETTERS}\\s]*[${LETTERS}])?`,
  "g",
);

/** `text` où chaque suite de caractères arabes (phrases comprises) est remplacée par `mask`. */
export function maskArabic(text: string, mask: string): string {
  return text.replace(ARABIC_RUN, mask);
}
