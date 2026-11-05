/**
 * Lecture d'un champ « en pourcents » de l'éditeur d'export (Gauche, Haut, Largeur, Hauteur : recette QA 3, P4).
 *
 * On tape ce que l'on veut, on lit ce qu'on peut : « 30 », « 30 % », « 12,5 », « −5 », mais aussi les chiffres arabo-indiens
 * (« ٣٠ », « ٣٫٥ », « ٣٠٪ ») et persans (« ۱۲ ») qu'un clavier arabe produit sans qu'on y pense. Tout le reste (« abc », un
 * emoji, « 1,2,3 ») n'est PAS lu : l'appelant le dit et réaffiche la valeur gardée, au lieu de laisser le texte invalide à
 * l'écran comme s'il avait été appliqué. Ce module est pur : ni DOM ni état.
 */

export type PercentReading =
  | { ok: true; percent: number }
  | { ok: false; reason: "empty" | "unreadable" };

const ARABIC_INDIC_ZERO = 0x0660; // ٠ … ٩
const EXTENDED_ZERO = 0x06f0; // ۰ … ۹ (persan, ourdou)

/** Un seul chiffre arabo-indien ou persan devient son chiffre ASCII ; tout autre caractère reste tel quel. */
function asciiDigit(char: string): string {
  const code = char.codePointAt(0) ?? 0;
  if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9)
    return String(code - ARABIC_INDIC_ZERO);
  if (code >= EXTENDED_ZERO && code <= EXTENDED_ZERO + 9)
    return String(code - EXTENDED_ZERO);
  return char;
}

/** Le texte ramené à l'écriture ASCII : chiffres, virgule ou séparateur décimal arabe → point, tirets → « - ». */
export function normalizeNumberText(text: string): string {
  // NFKC : chiffres pleine chasse, espaces insécables, « ％ » ; les chiffres arabes, eux, se traduisent à la main.
  let out = "";
  for (const char of text.normalize("NFKC")) {
    if (char === "٫" || char === ",") out += ".";
    else if (char === "−" || char === "–" || char === "—") out += "-";
    else out += asciiDigit(char);
  }
  return out;
}

const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function readPercent(text: string): PercentReading {
  let value = normalizeNumberText(text).trim();
  // Un seul signe « % » (ou « ٪ ») à la fin est permis : on tape souvent l'unité.
  value = value.replace(/[%٪]$/, "").trim();
  if (value === "") return { ok: false, reason: "empty" };
  if (!NUMBER.test(value)) return { ok: false, reason: "unreadable" };
  const percent = Number(value);
  return Number.isFinite(percent)
    ? { ok: true, percent }
    : { ok: false, reason: "unreadable" };
}

/** Un texte tapé, raccourci pour l'afficher dans un message (jamais une ligne de 500 signes). */
const shown = (text: string): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 16 ? `${flat.slice(0, 16)}…` : flat;
};

/** Ce qu'on dit quand le texte tapé n'est pas un nombre : la valeur gardée est réaffichée, jamais le texte invalide. */
export function percentRejection(
  label: string,
  text: string,
  reason: "empty" | "unreadable",
  kept: number,
): string {
  const keptText = `${label} reste à ${String(kept).replace(".", ",")} %.`;
  return reason === "empty"
    ? `Le champ « ${label} » était vide. ${keptText}`
    : `« ${shown(text)} » n’est pas un nombre. ${keptText}`;
}
