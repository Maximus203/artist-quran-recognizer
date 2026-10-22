import {
  PREFERENCE_DEFAULTS,
  preferencesPatchSchema,
  preferencesShape,
  type Preferences,
  type PreferencesPatch,
} from "./preferences-schema";
import { DEFAULT_QURAN_FONT, type QuranFontId } from "./quran-fonts";
import { clampQuranSize } from "./ui-prefs";

/**
 * Synchronisation des préférences avec le serveur (navigateur). Le serveur fait foi ; le
 * `localStorage` n'est qu'un CACHE de premier rendu et le filet quand le réseau manque. Tout ce
 * fichier est pur ou injecté (aucun `window`, aucun `fetch` direct) : l'envoi et l'horloge sont
 * fournis par l'appelant, donc testables à froid.
 */
export const PREFS_CACHE_KEY = "aqr.prefs.v2";
const CACHE_VERSION = 1;

export const mergePatch = (
  older: PreferencesPatch,
  newer: PreferencesPatch,
): PreferencesPatch => ({ ...older, ...newer });

export const applyPatch = (
  prefs: Preferences,
  patch: PreferencesPatch,
): Preferences => {
  const next = { ...prefs } as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch))
    if (value !== undefined) next[key] = value;
  return next as Preferences;
};

export type PrefsCache = { prefs: Preferences; pending: PreferencesPatch };

export const serializeCache = (
  userId: number,
  prefs: Preferences,
  pending: PreferencesPatch,
): string => JSON.stringify({ v: CACHE_VERSION, user: userId, prefs, pending });

/** Jamais fiable : un cache illisible, périmé ou d'un autre compte est ignoré. */
export function parseCache(
  raw: string | null | undefined,
  userId: number,
): PrefsCache | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return null;
  const record = data as Record<string, unknown>;
  if (record.v !== CACHE_VERSION || record.user !== userId) return null;
  const prefs = preferencesPatchSchema.safeParse(record.prefs);
  if (!prefs.success) return null;
  // Le cache complet doit porter toutes les clés : sinon on le jette (le serveur reste la source).
  const full = applyPatch(PREFERENCE_DEFAULTS, prefs.data);
  if (Object.keys(prefs.data).length !== Object.keys(preferencesShape).length)
    return null;
  // Une modification en attente invalide est écartée clé par clé ; les valides sont gardées.
  const pending: PreferencesPatch = {};
  if (typeof record.pending === "object" && record.pending !== null) {
    for (const [key, value] of Object.entries(record.pending)) {
      const shape = (
        preferencesShape as Record<string, { safeParse: (v: unknown) => { success: boolean } }>
      )[key];
      if (shape?.safeParse(value).success)
        (pending as Record<string, unknown>)[key] = value;
    }
  }
  return { prefs: full, pending };
}

export type Appearance = {
  /** `null` = suit le système. */
  theme: "light" | "dark" | null;
  /** Identifiant de police demandé (la disponibilité réelle est résolue après). */
  font: QuranFontId;
  /** Taille arabe en px (« 48px »), `null` = valeur du thème. */
  quranSize: string | null;
};

/** Ce que les préférences posent sur l'élément <html>. */
export function appearanceOf(prefs: Preferences): Appearance {
  return {
    theme: prefs.theme === "system" ? null : prefs.theme,
    font: prefs.arabicFont ?? DEFAULT_QURAN_FONT,
    quranSize:
      prefs.arabicSize === null ? null : `${clampQuranSize(prefs.arabicSize)}px`,
  };
}

export type SyncStatus = "idle" | "pending" | "saving" | "saved" | "error";

type Options = {
  /** Envoie une fusion partielle au serveur ; rejette en cas d'échec. */
  send: (patch: PreferencesPatch) => Promise<unknown>;
  delayMs: number;
  onStatus: (status: SyncStatus) => void;
};

/**
 * Anti-rebond + reprise. Les changements rapprochés partent en UNE requête ; un échec garde le
 * changement (sans réessai automatique en boucle : `retry()` est appelé au retour du réseau ou au
 * prochain changement) ; un changement fait pendant un envoi n'est jamais perdu ; une valeur plus
 * récente n'est jamais écrasée par une ancienne qui revient d'un échec.
 */
export class PrefsSync {
  private queue: PreferencesPatch = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(private readonly options: Options) {}

  pending(): PreferencesPatch {
    return { ...this.queue };
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(patch: PreferencesPatch): void {
    this.queue = mergePatch(this.queue, patch);
    this.options.onStatus("pending");
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), this.options.delayMs);
  }

  /** Reprise de modifications restées en attente (cache local) ; l'appelant lance `flush()`. */
  restore(patch: PreferencesPatch): void {
    this.queue = mergePatch(patch, this.queue);
  }

  /** Abandonne ce qui attend (une remise à zéro côté serveur l'emporte sur tout). */
  clear(): void {
    this.clearTimer();
    this.queue = {};
  }

  retry(): Promise<void> {
    return this.flush();
  }

  async flush(): Promise<void> {
    this.clearTimer();
    if (this.running || Object.keys(this.queue).length === 0) return;
    const taken = this.queue;
    this.queue = {};
    this.running = true;
    this.options.onStatus("saving");
    try {
      await this.options.send(taken);
      this.running = false;
      this.options.onStatus(
        Object.keys(this.queue).length === 0 ? "saved" : "pending",
      );
    } catch {
      this.running = false;
      // Les valeurs plus récentes déjà en file l'emportent sur celles qui reviennent.
      this.queue = mergePatch(taken, this.queue);
      this.options.onStatus("error");
    }
  }
}
