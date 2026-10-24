import { surahName } from "./surahs";

/** « Al-Fatiha 1:2 » à partir de « 1:2 » ; une référence illisible est rendue telle quelle (jamais devinée). */
export function verseName(ref: string): string {
  const match = /^(\d{1,3}):(\d{1,3})$/.exec(ref);
  if (!match) return ref;
  const surah = Number(match[1]);
  if (surah < 1 || surah > 114) return ref;
  return `${surahName(surah)} ${ref}`;
}

/** Durée « 00:21 » (minutes:secondes ; au-delà d'une heure, les minutes continuent : « 75:03 »). */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const plural = (n: number, one: string, many: string): string =>
  `${n} ${n > 1 ? many : one}`;

/** Un nombre à une décimale, virgule française. */
export const decimalFr = (value: number): string =>
  String(Math.round(value * 10) / 10).replace(".", ",");
