/**
 * Le testeur : un pseudonyme libre (jamais un nom complet ni une adresse e-mail), copié dans chaque
 * signalement et mémorisé dans le navigateur avec les 8 derniers utilisés.
 */

/** 2 à 24 caractères : lettres (toutes langues), chiffres, espace, `-` `_` `.`. Le `@` est exclu. */
export const TESTER_PATTERN = /^[\p{L}\p{N} _.-]{2,24}$/u;
export const TESTER_RULE_MESSAGE =
  "2 à 24 caractères : lettres, chiffres, espace, - _ . (pas d’adresse e-mail).";
export const MAX_RECENT_TESTERS = 8;
/** Auteur des signalements créés avant le suivi des testeurs (`aqr.review/1`). */
export const LEGACY_TESTER = "inconnu";

export type TesterCheck =
  | { ok: true; value: string }
  | { ok: false; message: string };

export function validateTester(raw: string): TesterCheck {
  const value = raw.trim();
  if (!TESTER_PATTERN.test(value))
    return { ok: false, message: TESTER_RULE_MESSAGE };
  return { ok: true, value };
}

/** Met `name` en tête de la liste, sans doublon (insensible à la casse), 8 au plus. */
export function rememberTester(recent: readonly string[], name: string) {
  const key = name.toLocaleLowerCase();
  return [
    name,
    ...recent.filter((item) => item.toLocaleLowerCase() !== key),
  ].slice(0, MAX_RECENT_TESTERS);
}

/** Liste lue depuis le stockage du navigateur : seuls les pseudonymes valides survivent. */
export function sanitizeRecent(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const check = validateTester(item);
    if (check.ok && !names.includes(check.value)) names.push(check.value);
  }
  return names.slice(0, MAX_RECENT_TESTERS);
}

export const initialOf = (name: string): string =>
  name.trim().charAt(0).toLocaleUpperCase() || "?";
