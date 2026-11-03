/**
 * Un nombre saisi à la française : « 7,0 », « 7.5 », « 42 », « -100 ». Renvoie `null` pour tout ce qui
 * n'est pas un nombre fini (vide, « abc », « 1e5 », « 1,2,3 »). Fonction pure.
 */
export function parseNumberFr(text: string): number | null {
  const clean = text.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^[+-]?\d+(\.\d+)?$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}
