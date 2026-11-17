import { api } from "./api-client";
import { SOURCE_BACKGROUND_ID } from "./export-video-backgrounds";
import { EXPORT_VIDEO_CONFIG } from "./export-video-config";
import type { VideoPrefs } from "./export-video-prefs";

/**
 * Réglages de l'éditeur d'export PAR VIDÉO, côté navigateur : lecture, sauvegarde automatique, et la règle de
 * priorité (voir `session-video-prefs.ts` pour le serveur). Le fichier est pur ou injecté : l'envoi vient de
 * l'appelant, donc testable à froid.
 */
const url = (sessionId: string) =>
  `/api/sessions/${encodeURIComponent(sessionId)}/video-prefs`;

/** Réglages enregistrés pour cette vidéo, ou `null` (jamais personnalisée). Jette si le serveur répond mal. */
export async function fetchSessionVideoPrefs(
  sessionId: string,
): Promise<VideoPrefs | null> {
  const data = await api<{ prefs: VideoPrefs | null }>(url(sessionId));
  return data.prefs;
}

export async function saveSessionVideoPrefs(
  sessionId: string,
  prefs: VideoPrefs,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  await api(url(sessionId), {
    method: "PUT",
    json: prefs,
    keepalive: options.keepalive,
  });
}

/**
 * Réglages de départ d'une vidéo :
 *  1. ceux de CETTE vidéo, s'il y en a (priorité absolue) ;
 *  2. sinon le réglage global du compte, comme point de départ d'une vidéo jamais personnalisée ;
 *  3. une vidéo envoyée (non personnalisée) ressort telle quelle : « vidéo d'origine » est son fond et son format.
 */
export function startingVideoPrefs({
  stored,
  account,
  isVideo,
}: {
  stored: VideoPrefs | null;
  account: VideoPrefs;
  isVideo: boolean;
}): VideoPrefs {
  if (stored) return structuredClone(stored);
  const start = structuredClone(account);
  return isVideo
    ? { ...start, orientation: "source", background: SOURCE_BACKGROUND_ID }
    : start;
}

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

type AutosaveOptions = {
  /** Envoie le jeu complet de réglages ; rejette en cas d'échec. */
  send: (prefs: VideoPrefs) => Promise<unknown>;
  delayMs?: number;
  onStatus?: (status: AutosaveStatus) => void;
};

/**
 * Sauvegarde automatique, anti-rebond : les changements rapprochés partent en UNE requête (la valeur la plus
 * récente) ; jamais deux envois en même temps ; un changement fait pendant un envoi n'est pas perdu ; un échec
 * garde la valeur sans réessai en boucle (elle repart au prochain changement ou à `flush()`) ; une valeur plus
 * récente n'est jamais écrasée par une ancienne qui revient d'un échec. `flush()` envoie tout de suite et attend.
 */
export class PrefsAutosave {
  private latest: VideoPrefs | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private readonly delayMs: number;

  constructor(private readonly options: AutosaveOptions) {
    this.delayMs =
      options.delayMs ?? EXPORT_VIDEO_CONFIG.videoPrefs.saveDelayMs;
  }

  private status(value: AutosaveStatus) {
    this.options.onStatus?.(value);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  schedule(prefs: VideoPrefs): void {
    this.latest = prefs;
    this.status("pending");
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Abandonne ce qui attend (changement de vidéo : rien ne doit partir vers une autre). */
  cancel(): void {
    this.clearTimer();
    this.latest = null;
  }

  async flush(): Promise<void> {
    this.clearTimer();
    // Un envoi est en cours : on l'attend, puis ce qui est arrivé entre-temps part à son tour.
    while (this.inFlight) await this.inFlight;
    if (this.latest === null) return;
    const taken = this.latest;
    this.latest = null;
    this.status("saving");
    const run = (async () => {
      try {
        await this.options.send(taken);
        this.status(this.latest === null ? "saved" : "pending");
      } catch {
        // La valeur plus récente, déjà en file, l'emporte sur celle qui revient.
        this.latest ??= taken;
        this.status("error");
      }
    })();
    this.inFlight = run;
    await run;
    this.inFlight = null;
  }
}
