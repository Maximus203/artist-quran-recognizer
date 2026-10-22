import type { Recognition } from "./recognition";
import { surahName } from "./surahs";

/**
 * Noms de session : défaut intelligent, étiquette de contenu, texte de recherche. Fonctions pures.
 *
 * Le nom par défaut vient du nom de fichier NETTOYÉ ; s'il ne reste rien de lisible, ou pour un
 * enregistrement au micro, un nom horodaté en français. Un nom choisi par l'utilisateur
 * (`name_source = 'user'`) n'est jamais remplacé automatiquement.
 */
const MONTHS = [
  "janv.",
  "févr.",
  "mars",
  "avr.",
  "mai",
  "juin",
  "juil.",
  "août",
  "sept.",
  "oct.",
  "nov.",
  "déc.",
];
export const MAX_NAME_LENGTH = 120;

/** « 22 oct. à 17:51 » dans le fuseau demandé (`AQR_TIMEZONE`, sinon celui de la machine). */
export function formatStamp(
  createdAt: string | Date,
  timeZone?: string,
): string {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const parts = new Intl.DateTimeFormat("fr-FR", {
    timeZone,
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const pick = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";
  const month = MONTHS[Number(pick("month")) - 1] ?? pick("month");
  const hour = pick("hour") === "24" ? "00" : pick("hour");
  return `${Number(pick("day"))} ${month} à ${hour}:${pick("minute")}`;
}

/** Nom de repli : « Enregistrement du 22 oct. à 17:51 » (micro) ou « Audio du … » (fichier). */
export function fallbackName(
  createdAt: string | Date,
  sourceKind: "file" | "microphone" | null | undefined,
  timeZone?: string,
): string {
  return `${sourceKind === "microphone" ? "Enregistrement" : "Audio"} du ${formatStamp(createdAt, timeZone)}`;
}

const EXTENSION = /\.[A-Za-z0-9]{1,5}$/;
/** Identifiant de vidéo en fin de nom : `[dQw4w9WgXcQ]` (yt-dlp). */
const BRACKET_ID = /\[[A-Za-z0-9_-]{6,}\]/g;
/** Horodatage de fichier : `2026-10-20T17-58-52-469`, `2026-10-20_17-58-52`, `20261020-175852`. */
const STAMPS = [
  /\b\d{4}-\d{2}-\d{2}[T_ ]\d{2}[-:.]\d{2}[-:.]\d{2}(?:[-.]\d{1,3})?Z?\b/g,
  /\b\d{8}[-_T]\d{6}\b/g,
];
/** Nom de capture de l'enregistreur/appareil sans information (« recording », « audio 3 »…). */
const GENERIC =
  /^(?:recording|record|audio|enregistrement|voice|memo|new recording|sans titre|untitled)[\s.-]*\d*$/i;

/** Nom de fichier lisible, ou `null` s'il n'en reste rien d'utile. */
export function cleanFilename(filename: string): string | null {
  let text = filename.normalize("NFC").replace(/[\u0000-\u001f]/g, "");
  text = text.replace(EXTENSION, "");
  text = text.replace(BRACKET_ID, " ").replace(/_+/g, " ");
  for (const stamp of STAMPS) text = text.replace(stamp, " ");
  text = text
    .replace(/-{2,}/g, " - ")
    .replace(/\s+-\s+(?=-|$)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s._-]+|[\s._-]+$/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!/\p{L}/u.test(text)) return null; // que des chiffres ou de la ponctuation
  if (GENERIC.test(text)) return null;
  // Empreinte ou identifiant opaque (uuid, hexadécimal long sans espace) : illisible.
  if (/^[0-9a-f-]{16,}$/i.test(text) && !text.includes(" ")) return null;
  if (text.length > MAX_NAME_LENGTH)
    text = `${text.slice(0, MAX_NAME_LENGTH - 1).trimEnd()}…`;
  return text;
}

/** Nom par défaut d'une session importée. */
export function defaultSessionName(
  filename: string,
  createdAt: string | Date,
  sourceKind: "file" | "microphone" | null | undefined,
  timeZone?: string,
): string {
  if (sourceKind === "microphone")
    return fallbackName(createdAt, sourceKind, timeZone);
  return (
    cleanFilename(filename) ?? fallbackName(createdAt, sourceKind, timeZone)
  );
}

/** Nom choisi par l'utilisateur : espaces repliés, sans caractère de contrôle, 1–120 caractères. */
export function cleanUserName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= 1 && text.length <= MAX_NAME_LENGTH ? text : null;
}

// ── Étiquette de contenu ──────────────────────────────────────────────────────────────────────
type Run = [number, number];

/** Verset 5,6,7,9 → [[5,7],[9,9]]. */
function runs(verses: number[]): Run[] {
  const sorted = [...new Set(verses)].sort((a, b) => a - b);
  const out: Run[] = [];
  for (const verse of sorted) {
    const last = out[out.length - 1];
    if (last && verse === last[1] + 1) last[1] = verse;
    else out.push([verse, verse]);
  }
  return out;
}

const range = ([a, b]: Run) => (a === b ? `${a}` : `${a}–${b}`);
const MAX_RUNS = 3;
const MAX_SURAHS = 3;

/**
 * « Yusuf 12:11–31 », « Al-Fatiha 1:1–7 + Al-Baqara 2:1–5 » d'après les versets RECOGNIZED ou
 * INFERRED du résultat (les versets incertains n'ont pas de référence : invariant I3, on ne
 * nomme pas un verset douteux). Sourates dans l'ordre d'apparition. Plus de 3 tronçons dans une
 * sourate : une seule plage englobante ; plus de 3 sourates : « + N autres ». `null` sans verset.
 */
export function contentLabel(
  recognition: Pick<Recognition, "intervals">,
): string | null {
  const bySurah = new Map<number, { first: number; verses: number[] }>();
  for (const interval of recognition.intervals) {
    if (
      interval.kind !== "verse" ||
      !interval.ref ||
      interval.status === "uncertain"
    )
      continue;
    const [surah, verse] = interval.ref.split(":").map(Number);
    const entry = bySurah.get(surah) ?? {
      first: interval.t?.[0] ?? Number.MAX_SAFE_INTEGER,
      verses: [],
    };
    entry.first = Math.min(entry.first, interval.t?.[0] ?? entry.first);
    entry.verses.push(verse);
    bySurah.set(surah, entry);
  }
  if (bySurah.size === 0) return null;
  const ordered = [...bySurah.entries()].sort(
    (a, b) => a[1].first - b[1].first || a[0] - b[0],
  );
  const parts = ordered.slice(0, MAX_SURAHS).map(([surah, { verses }]) => {
    const all = runs(verses);
    const shown =
      all.length > MAX_RUNS
        ? range([all[0][0], all[all.length - 1][1]])
        : all.map(range).join(", ");
    return `${surahName(surah)} ${surah}:${shown}`;
  });
  const more = ordered.length - MAX_SURAHS;
  return (
    parts.join(" + ") +
    (more > 0 ? ` + ${more} autre${more > 1 ? "s" : ""}` : "")
  );
}

// ── Recherche ─────────────────────────────────────────────────────────────────────────────────
/** Minuscules, sans accents ni signes diacritiques arabes, espaces repliés : clé de recherche et de tri. */
export function normalizeSearch(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ًͯ-ٰٟۖ-ۭ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
