/**
 * Liste des sessions = file d'attente lisible. Tout ce qui se calcule pour l'affichage (statut, ETA,
 * progression, groupes, filtres, compteurs) vit ici, en fonctions pures : l'interface ne décide
 * de rien. La source des chiffres est le serveur (`GET /api/sessions` : `eta_s`, `elapsed_s`,
 * `queue_position`, `unread`…) ; on n'invente jamais une estimation.
 */
import { acceptedVideoExtensions } from "./audio-upload";
import {
  formatClockLength,
  formatDurationFr,
  formatEtaFr,
  formatHourMinute,
  formatRealtimeFactor,
} from "./format";
import type { SessionView } from "./session-view";

/** Une session telle que l'API la sert (sans le numéro de processus). */
export type ListedSession = Omit<SessionView, "pid">;

export type SessionFilter = "all" | "active" | "unread";
export type RowTone = "neutral" | "accent" | "warn" | "danger";

export type SessionRow = {
  id: string;
  name: string;
  glyph: SessionView["state"];
  rank: number | null;
  status: string;
  tone: RowTone;
  meta: string;
  mediaKind: "audio" | "video";
  /** Pourcentage en cours d'analyse, sinon l'heure ou la date. */
  endLabel: string;
  /** 0 à 0,95 tant que l'analyse tourne ; null = pas de progression (ou indéterminée). */
  progress: number | null;
  indeterminate: boolean;
  unread: boolean;
  canRetry: boolean;
  canCancel: boolean;
};

/** Plafond de la barre tant que l'analyse n'est pas réellement finie. */
const PROGRESS_CAP = 0.95;
const REASON_MAX = 48;

const ENGINE_LABELS: Record<string, string> = {
  cascade: "Cascade",
  fastconformer: "FastConformer",
  whisper: "Whisper",
  "muno-streaming": "Muno",
};
export const engineLabel = (engine: string | null | undefined): string =>
  engine ? (ENGINE_LABELS[engine] ?? engine) : "";

export const isVideoSession = (view: Pick<SessionView, "extension">): boolean =>
  acceptedVideoExtensions.has((view.extension ?? "").toLowerCase());

const startOfDay = (time: number): number => {
  const d = new Date(time);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Heure aujourd'hui, « hier », sinon « 20 oct. ». */
export function formatListDate(iso: string, now: number): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  if (days <= 0) return formatHourMinute(iso);
  if (days === 1) return "hier";
  return new Date(at).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
  });
}

const shortReason = (error: string | null): string => {
  const line = (error ?? "").split("\n")[0].trim();
  if (!line) return "analyse interrompue";
  return line.length > REASON_MAX ? `${line.slice(0, REASON_MAX)}…` : line;
};

function waitingFor(seconds: number): string {
  const text = formatEtaFr(seconds);
  return text === "≈ 1 min" || text.startsWith("moins")
    ? `${text} restante`
    : `${text} restantes`;
}

const spentSeconds = (view: ListedSession): number | null => {
  if (typeof view.duration_s === "number" && view.duration_s > 0)
    return view.duration_s;
  const start = Date.parse(view.started_at ?? "");
  const end = Date.parse(view.finished_at ?? "");
  return Number.isFinite(start) && Number.isFinite(end) && end >= start
    ? (end - start) / 1000
    : null;
};

export function buildRow(view: ListedSession, now: number): SessionRow {
  const mediaKind = isVideoSession(view) ? "video" : "audio";
  const length = view.audio_duration_s
    ? formatClockLength(view.audio_duration_s)
    : "";
  const base = [mediaKind === "video" ? "Vidéo" : "Audio"];
  if (length) base.push(length);
  const engine = engineLabel(view.engine ?? view.asr);
  if (engine) base.push(engine);

  const row: SessionRow = {
    id: view.id,
    name: view.name,
    glyph: view.state,
    rank: null,
    status: "",
    tone: "neutral",
    meta: "",
    mediaKind,
    endLabel: formatListDate(
      view.finished_at ?? view.queued_at ?? view.created_at,
      now,
    ),
    progress: null,
    indeterminate: false,
    unread: view.unread === true,
    canRetry: false,
    canCancel: false,
  };

  switch (view.state) {
    case "ready":
      row.status = "Prêt à analyser";
      row.endLabel = formatListDate(view.created_at, now);
      break;
    case "queued":
      row.rank = view.queue_position;
      row.status = `En attente · n° ${view.queue_position ?? "?"} dans la file`;
      row.endLabel = formatListDate(view.queued_at ?? view.created_at, now);
      row.canCancel = true;
      if (typeof view.eta_s === "number")
        base.push(`${formatEtaFr(view.eta_s)} avant la fin`);
      break;
    case "running": {
      row.canCancel = true;
      row.endLabel = "";
      const elapsed = view.elapsed_s;
      if (view.eta_overrun) {
        row.status = "Analyse en cours · plus long que prévu";
        row.tone = "warn";
        row.indeterminate = true;
      } else if (
        typeof view.eta_s === "number" &&
        typeof elapsed === "number"
      ) {
        row.status = `Analyse en cours · ${waitingFor(view.eta_s)}`;
        row.tone = "accent";
        const total = elapsed + view.eta_s;
        row.progress =
          total > 0 ? Math.min(PROGRESS_CAP, elapsed / total) : null;
        row.indeterminate = row.progress === null;
        if (row.progress !== null)
          row.endLabel = `${Math.round(row.progress * 100)} %`;
      } else {
        row.status =
          typeof elapsed === "number"
            ? `Analyse en cours · ${formatDurationFr(elapsed)} écoulées`
            : "Analyse en cours";
        row.tone = "accent";
        row.indeterminate = true;
      }
      break;
    }
    case "done": {
      const spent = spentSeconds(view);
      const factor = formatRealtimeFactor(view.audio_duration_s, spent);
      const head = row.unread ? "Résultat prêt" : "Terminé";
      const parts: string[] = [];
      if (spent !== null)
        parts.push(
          row.unread
            ? formatDurationFr(spent)
            : `en ${formatDurationFr(spent)}`,
        );
      if (factor) parts.push(factor);
      row.status =
        parts.length === 0
          ? head
          : row.unread
            ? `${head} · ${parts.join(" · ")}`
            : `${head} ${parts.join(" · ")}`;
      break;
    }
    case "failed":
      row.status = `Échec · ${shortReason(view.error)}`;
      row.tone = "danger";
      row.canRetry = true;
      break;
    case "cancelled": {
      const spent = spentSeconds(view);
      row.status =
        spent === null ? "Annulé" : `Annulé après ${formatDurationFr(spent)}`;
      row.canRetry = true;
      row.unread = false;
      break;
    }
  }
  row.meta = base.join(" · ");
  return row;
}

const finishedAt = (view: ListedSession): string =>
  view.finished_at ?? view.created_at;

export type SessionGroups = {
  /** Analyse en cours puis en attente, dans l'ordre de la file. */
  queue: ListedSession[];
  /** Importées sans lancement : elles attendent un clic. */
  ready: ListedSession[];
  /** Terminées, en échec ou annulées, les plus récentes d'abord. */
  done: ListedSession[];
};

export function groupViews(views: readonly ListedSession[]): SessionGroups {
  const queue = views
    .filter((v) => v.state === "running" || v.state === "queued")
    .sort(
      (a, b) =>
        Number(b.state === "running") - Number(a.state === "running") ||
        (a.queue_position ?? 0) - (b.queue_position ?? 0),
    );
  const ready = views
    .filter((v) => v.state === "ready")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const done = views
    .filter((v) => ["done", "failed", "cancelled"].includes(v.state))
    .sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)));
  return { queue, ready, done };
}

const isActive = (v: ListedSession) =>
  v.state === "running" || v.state === "queued";

export function filterViews(
  views: readonly ListedSession[],
  filter: SessionFilter,
): ListedSession[] {
  if (filter === "active") return views.filter(isActive);
  if (filter === "unread") return views.filter((v) => v.unread === true);
  return [...views];
}

export function sessionCounts(views: readonly ListedSession[]) {
  return {
    all: views.length,
    active: views.filter(isActive).length,
    unread: views.filter((v) => v.unread === true).length,
  };
}

/** « 1 en cours · 1 en attente · fin estimée dans ≈ 12 min » ; null si la file est vide. */
export function queueSummary(views: readonly ListedSession[]): string | null {
  const running = views.filter((v) => v.state === "running").length;
  const waiting = views.filter((v) => v.state === "queued").length;
  if (running + waiting === 0) return null;
  const parts: string[] = [];
  if (running) parts.push(`${running} en cours`);
  if (waiting) parts.push(`${waiting} en attente`);
  const active = views.filter(isActive);
  const etas = active.map((v) => v.eta_s);
  if (etas.every((eta): eta is number => typeof eta === "number"))
    parts.push(`fin estimée dans ${formatEtaFr(Math.max(...etas))}`);
  return parts.join(" · ");
}

export const pageTitle = (unread: number): string =>
  unread > 0 ? `(${unread}) Quran TR` : "Quran TR";

/** Ce qui mérite un coup d'œil panneau fermé : résultats non lus + analyses actives. */
export function attentionCount(views: readonly ListedSession[]): number {
  return views.filter((v) => v.unread === true || isActive(v)).length;
}
