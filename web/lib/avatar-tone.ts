/**
 * Avatar par défaut : initiale + couleur stable dérivée du pseudo (fonctions pures, partagées par
 * le serveur et le navigateur). Les huit couleurs sont des JETONS (`--av-0` … `--av-7` dans
 * `tokens.css`) : ici on ne choisit qu'un indice, jamais une valeur visuelle.
 */
export const AVATAR_TONES = 8;

/** Même forme normalisée que l'unicité des pseudos : NFKC, espaces repliés, minuscules. */
const normalized = (username: string): string =>
  username.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Indice de couleur (0 à 7) : empreinte FNV-1a 32 bits du pseudo normalisé. */
export function avatarTone(username: string): number {
  let hash = 0x811c9dc5;
  for (const char of normalized(username)) {
    hash ^= char.codePointAt(0) as number;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % AVATAR_TONES;
}

/** Première lettre en capitale (un caractère entier : arabe et emoji compris), « ? » si le pseudo est vide. */
export function avatarInitial(username: string): string {
  const first = Array.from(username.normalize("NFKC").trim())[0];
  return first ? first.toLocaleUpperCase() : "?";
}
