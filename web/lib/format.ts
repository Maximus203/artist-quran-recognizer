/**
 * Formats d'affichage (temps, durées, estimations). Fonctions pures : aucune dépendance au DOM,
 * le français est écrit ici une seule fois (virgule décimale, apostrophe typographique).
 */

const finiteOrZero = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : 0;

/** `mm:ss.d` (ou `h:mm:ss.d`) au dixième : le pas de la revue humaine. */
export function formatTenths(seconds: number): string {
  const tenthsTotal = Math.round(finiteOrZero(seconds) * 10);
  const tenths = tenthsTotal % 10;
  const whole = Math.floor(tenthsTotal / 10);
  const s = whole % 60;
  const m = Math.floor(whole / 60) % 60;
  const h = Math.floor(whole / 3600);
  const mm = String(m).padStart(2, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}.${tenths}`;
}

/** Nombre à virgule française (`3,4`). */
export function formatSecondsFr(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}

/** Durée lisible : `26 s`, `5 min 40 s`, `1 h 12 min`. */
export function formatDurationFr(seconds: number): string {
  const total = Math.round(finiteOrZero(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h) return m ? `${h} h ${m} min` : `${h} h`;
  if (m) return s ? `${m} min ${s} s` : `${m} min`;
  return `${s} s`;
}

/** Reste à attendre, arrondi à la minute supérieure ; « moins d'une minute » sous 60 s. */
export function formatEtaFr(seconds: number): string {
  const value = finiteOrZero(seconds);
  if (value < 60) return "moins d’une minute";
  const minutes = Math.ceil(value / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h) return m ? `≈ ${h} h ${m} min` : `≈ ${h} h`;
  return `≈ ${minutes} min`;
}

/** Durée d'un audio en horloge : `18:42`, `1:12:08`. */
export function formatClockLength(seconds: number): string {
  const total = Math.round(finiteOrZero(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

/** « ×7,1 » : durée de la source ÷ durée de l'analyse (7 fois plus vite que l'audio). */
export function formatRealtimeFactor(
  audioSeconds: number | null | undefined,
  processingSeconds: number | null | undefined,
): string | null {
  if (
    !audioSeconds ||
    !processingSeconds ||
    !(audioSeconds > 0) ||
    !(processingSeconds > 0)
  )
    return null;
  const factor = audioSeconds / processingSeconds;
  return `×${formatSecondsFr(factor, factor < 1 ? 2 : 1)}`;
}

/** Ancienneté d'une date ISO : « à l'instant », « il y a 12 min », « hier », « 20 oct. ». */
export function formatRelative(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const delta = Math.max(0, now - at);
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "hier";
  return new Date(at).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

/** Taille lisible en français : « 59 Ko », « 1,5 Mo », « 2,0 Go » (base 1024). */
export function formatBytesFr(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} o`;
  const units = ["Ko", "Mo", "Go", "To"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits).replace(".", ",")} ${units[unit]}`;
}

/** Heure locale `HH:MM` (colonne de droite de la liste des sessions). */
export function formatHourMinute(iso: string): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return "";
  return at.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}
