/**
 * Visibilité de la file, en privé : un utilisateur sait QU'IL ATTEND ET POURQUOI, sans voir les
 * détails d'un autre compte. La file compte toute la machine (analyses et exports vidéo), mais ce
 * qui en sort dépend de qui regarde :
 *  - ses propres jobs : type, état, position (« 3e dans la file »), attente estimée si l'historique
 *    le permet, sinon « estimation indisponible » (jamais une valeur inventée) ;
 *  - ceux des autres : seulement des NOMBRES (« une génération est en cours, une autre en attente »),
 *    jamais un titre, un nom, un identifiant, une durée ni un contenu ;
 *  - exception voulue : une génération publique (portée `global`) est visible de tous, titre compris.
 * Fonction synchrone, sans disque : l'état d'une session vient de l'index, la file de `peekQueue`.
 */
import { canView, type Actor } from "./access";
import type { Db } from "./db";
import { maxConcurrent, pendingEngines } from "./jobs";
import { peekQueue } from "./queue";
import { estimationRows, type MetaRow } from "./session-index";
import { liteSession } from "./session-service";
import { buildViews } from "./session-view";
import { listVideoJobs } from "./video-jobs";

export type Snapshot = { active: string[]; waiting: string[] };
export type VideoJobInfo = {
  /** Clé dans la file (`video:<id>`). */
  key: string;
  sessionId: string;
  userId: number;
  state: "queued" | "running";
};
export type QueueSources = {
  now: number;
  concurrency: number;
  queue: Snapshot | null;
  videoJobs: VideoJobInfo[];
  pendingEngines?: Record<string, string>;
};

export type MineEntry = {
  kind: "analysis" | "video";
  session_id: string;
  state: "running" | "queued";
  /** Rang dans l'attente (1 = le prochain) ; null si déjà en cours. */
  position: number | null;
  position_label: string | null;
  eta_s: number | null;
  eta_label: string;
};
export type SharedEntry = {
  session_id: string;
  name: string;
  kind: "analysis" | "video";
  state: "running" | "queued";
};
export type QueueStatus = {
  mine: MineEntry[];
  others: { running: number; waiting: number; shared: SharedEntry[] };
  /** Phrase à afficher quand d'autres comptes occupent la machine ; null sinon. */
  message: string | null;
};

export function ordinalFr(n: number): string {
  return n === 1 ? "1re" : `${n}e`;
}

export function describeWait(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds))
    return "estimation indisponible";
  if (seconds < 60) return "moins d'une minute";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `environ ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `environ ${hours} h ${String(minutes % 60).padStart(2, "0")}`;
}

export function queueMessage(others: {
  running: number;
  waiting: number;
}): string | null {
  const { running, waiting } = others;
  if (running + waiting === 0) return null;
  const parts: string[] = [];
  if (running > 0)
    parts.push(
      running === 1
        ? "une génération est en cours"
        : `${running} générations sont en cours`,
    );
  if (waiting > 0) {
    if (running > 0)
      parts.push(
        waiting === 1
          ? "une autre est en attente"
          : `${waiting} autres sont en attente`,
      );
    else
      parts.push(
        waiting === 1
          ? "une génération est en attente"
          : `${waiting} générations sont en attente`,
      );
  }
  return `Le système est occupé : ${parts.join(" et ")}.`;
}

type Entry = {
  kind: "analysis" | "video";
  key: string;
  sessionId: string;
  ownerId: number | null;
  meta: MetaRow | null;
  phase: "running" | "queued";
  position: number | null;
};

export function queueStatusFor(
  db: Db,
  me: Actor,
  sources: QueueSources = liveSources(),
): QueueStatus {
  const rows = estimationRows(db);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const videos = new Map(sources.videoJobs.map((job) => [job.key, job]));
  const snapshot = sources.queue ?? { active: [], waiting: [] };

  // Ordre de service de toute la machine : en cours d'abord, puis l'attente (file du serveur, puis
  // les « queued » sur disque que ce serveur ne connaît pas encore, par ancienneté).
  const known = new Set([...snapshot.active, ...snapshot.waiting]);
  const runningKeys = [
    ...snapshot.active,
    ...rows
      .filter((r) => r.state === "running" && !known.has(r.id))
      .map((r) => r.id),
  ];
  const unseen = rows
    .filter((r) => r.state === "queued" && !known.has(r.id))
    .sort(
      (x, y) =>
        x.created_at.localeCompare(y.created_at) || x.id.localeCompare(y.id),
    )
    .map((r) => r.id);
  const waitingKeys = [...snapshot.waiting, ...unseen];

  const toEntry = (
    key: string,
    phase: Entry["phase"],
    position: number | null,
  ): Entry | null => {
    if (key.startsWith("video:")) {
      const video = videos.get(key);
      if (!video) return null;
      return {
        kind: "video",
        key,
        sessionId: video.sessionId,
        ownerId: video.userId,
        meta: byId.get(video.sessionId) ?? null,
        phase,
        position,
      };
    }
    const meta = byId.get(key);
    if (!meta) return null;
    return {
      kind: "analysis",
      key,
      sessionId: key,
      ownerId: meta.owner_id,
      meta,
      phase,
      position,
    };
  };
  const entries: Entry[] = [
    ...runningKeys.map((k) => toEntry(k, "running", null)),
    ...waitingKeys.map((k, i) => toEntry(k, "queued", i + 1)),
  ].filter((e): e is Entry => e !== null);

  // Estimations : seulement pour les analyses, et jamais derrière un rendu vidéo (durée inconnue).
  const views = buildViews(rows.map(liteSession), {
    now: sources.now,
    concurrency: sources.concurrency,
    queue: snapshot,
    pendingEngines: sources.pendingEngines,
  });
  const eta = new Map(views.map((v) => [v.id, v.eta_s]));
  const orderedKeys = entries.map((e) => e.key);
  const videoAhead = (key: string) =>
    orderedKeys
      .slice(0, orderedKeys.indexOf(key))
      .some((k) => k.startsWith("video:"));

  const mine: MineEntry[] = [];
  const others = { running: 0, waiting: 0, shared: [] as SharedEntry[] };
  for (const entry of entries) {
    if (entry.ownerId !== null && entry.ownerId === me.id) {
      const seconds =
        entry.kind === "analysis" && !videoAhead(entry.key)
          ? (eta.get(entry.sessionId) ?? null)
          : null;
      mine.push({
        kind: entry.kind,
        session_id: entry.sessionId,
        state: entry.phase,
        position: entry.position,
        position_label:
          entry.position === null
            ? null
            : `${ordinalFr(entry.position)} dans la file`,
        eta_s: seconds,
        eta_label: describeWait(seconds),
      });
      continue;
    }
    if (entry.phase === "running") others.running += 1;
    else others.waiting += 1;
    // Une génération publique est visible de tous ; une privée n'apparaît que dans les nombres.
    if (entry.meta && canView(me, entry.meta))
      others.shared.push({
        session_id: entry.sessionId,
        name: entry.meta.name,
        kind: entry.kind,
        state: entry.phase,
      });
  }
  return { mine, others, message: queueMessage(others) };
}

export function liveSources(): QueueSources {
  return {
    now: Date.now(),
    concurrency: maxConcurrent(),
    queue: peekQueue()?.snapshot() ?? null,
    videoJobs: listVideoJobs(),
    pendingEngines: pendingEngines(),
  };
}
