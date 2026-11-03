/**
 * Tableau de bord « Performance » : combien de temps prend une analyse, et à quelle vitesse.
 * Calculé à partir des sessions terminées (durées réelles mesurées par le serveur) : aucun chiffre
 * n'est inventé, une session sans durées exploitables n'entre dans aucune moyenne.
 */
import { acceptedVideoExtensions } from "./audio-upload";

export type Period = "7d" | "30d" | "all";

export type PerfSession = {
  id: string;
  name: string;
  extension?: string;
  state: string;
  engine?: string | null;
  asr?: string | null;
  audio_duration_s?: number | null;
  duration_s?: number | null;
  finished_at: string | null;
  /** Propriétaire : seules les sessions globales sont nommées dans les « dernières analyses ». */
  owner?: { id: number; username: string } | null;
};

export type EnginePerf = {
  engine: string;
  label: string;
  count: number;
  /** Médiane du facteur temps réel (durée de l'audio ÷ durée de l'analyse). */
  medianFactor: number;
  meanDurationS: number;
  /** Longueur de barre relative au moteur le plus rapide (0 à 1). */
  ratio: number;
};

export type RecentAnalysis = {
  id: string;
  name: string;
  kind: "audio" | "video";
  audioS: number;
  processingS: number;
  factor: number;
  finishedAt: string;
  /** Pseudonyme du testeur, ou null (session d'avant les comptes). */
  owner: string | null;
};

export type PerfModel = {
  analyses: number;
  meanDurationS: number | null;
  medianFactor: number | null;
  audioTotalS: number;
  videoAudioS: number;
  /** Durée estimée d'une heure d'audio (3600 ÷ facteur médian), ou null. */
  hourOfAudioS: number | null;
  engines: EnginePerf[];
  recent: RecentAnalysis[];
};

const PERIOD_DAYS: Record<Period, number | null> = {
  "7d": 7,
  "30d": 30,
  all: null,
};
const RECENT_COUNT = 10;
const ENGINE_LABELS: Record<string, string> = {
  cascade: "Cascade",
  fastconformer: "FastConformer",
  whisper: "Whisper",
  "muno-streaming": "Muno Streaming",
};

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const positive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

/** Pour les grands chiffres : 242 s → « 4 min 02 s » ; 3720 s → « 1 h 02 ». */
export function splitDuration(seconds: number): { n: string; u: string }[] {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h)
    return [
      { n: String(h), u: "h" },
      { n: String(m).padStart(2, "0"), u: "" },
    ];
  if (m)
    return [
      { n: String(m), u: "min" },
      { n: String(s).padStart(2, "0"), u: "s" },
    ];
  return [{ n: String(s), u: "s" }];
}

export function buildPerformance(
  sessions: readonly PerfSession[],
  period: Period,
  now: number,
): PerfModel {
  const days = PERIOD_DAYS[period];
  const since = days === null ? -Infinity : now - days * 86_400_000;
  const usable = sessions.filter(
    (s) =>
      s.state === "done" &&
      positive(s.audio_duration_s) &&
      positive(s.duration_s) &&
      Date.parse(s.finished_at ?? "") >= since,
  );
  const factorOf = (s: PerfSession) =>
    (s.audio_duration_s as number) / (s.duration_s as number);
  const isVideo = (s: PerfSession) =>
    acceptedVideoExtensions.has((s.extension ?? "").toLowerCase());

  const mean = (values: number[]) =>
    values.reduce((sum, v) => sum + v, 0) / values.length;
  const medianFactor = median(usable.map(factorOf));

  const byEngine = new Map<string, PerfSession[]>();
  for (const s of usable) {
    const key = s.engine ?? s.asr ?? "inconnu";
    byEngine.set(key, [...(byEngine.get(key) ?? []), s]);
  }
  const engines = [...byEngine.entries()]
    .map(([engine, list]) => ({
      engine,
      label: ENGINE_LABELS[engine] ?? engine,
      count: list.length,
      medianFactor: median(list.map(factorOf)) as number,
      meanDurationS: mean(list.map((s) => s.duration_s as number)),
      ratio: 0,
    }))
    .sort((a, b) => b.medianFactor - a.medianFactor || b.count - a.count);
  const fastest = engines[0]?.medianFactor ?? 0;
  for (const e of engines) e.ratio = fastest > 0 ? e.medianFactor / fastest : 0;

  const recent = [...usable]
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))
    .slice(0, RECENT_COUNT)
    .map(
      (s): RecentAnalysis => ({
        id: s.id,
        name: s.name,
        kind: isVideo(s) ? "video" : "audio",
        audioS: s.audio_duration_s as number,
        processingS: s.duration_s as number,
        factor: factorOf(s),
        finishedAt: s.finished_at as string,
        owner: s.owner?.username ?? null,
      }),
    );

  return {
    analyses: usable.length,
    meanDurationS:
      usable.length > 0
        ? mean(usable.map((s) => s.duration_s as number))
        : null,
    medianFactor,
    audioTotalS: usable.reduce(
      (sum, s) => sum + (s.audio_duration_s as number),
      0,
    ),
    videoAudioS: usable
      .filter(isVideo)
      .reduce((sum, s) => sum + (s.audio_duration_s as number), 0),
    hourOfAudioS: medianFactor ? 3600 / medianFactor : null,
    engines,
    recent,
  };
}
