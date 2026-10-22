/**
 * Vues de session pour l'API : la session persistée + ce qui se calcule à la lecture (position dans
 * la file, non lu, estimation). Aucune de ces valeurs n'est écrite sur le disque : `buildViews` et
 * `buildStats` sont des fonctions pures (testables sans serveur) ; seuls `listSessionViews`,
 * `readSessionView` et `readStats` touchent au disque.
 */
import { maxConcurrent, pendingEngines } from "./jobs";
import {
  fitEngine,
  predictTotal,
  projectQueue,
  rtfStats,
  type EstimateRefusal,
  type Fit,
  type HistoryPoint,
  type RtfStats,
} from "./estimate";
import { peekQueue } from "./queue";
import { elapsedSeconds, isUnread } from "./session-meta";
import {
  backfillDerived,
  listSessions,
  readSession,
  type Session,
} from "./store";

export type EtaReason =
  | EstimateRefusal
  | "audio_duration_unknown"
  | "ahead_unknown";

export type SessionView = Session & {
  /** Rang dans l'attente (1 = prochaine) ; null hors attente. */
  queue_position: number | null;
  /** Terminée (réussie ou en échec) et jamais ouverte. */
  unread: boolean;
  /** Secondes depuis le départ du traitement ; null si pas en cours. */
  elapsed_s: number | null;
  /**
   * Secondes restantes estimées (en cours : estimation − écoulé, borné à 0 ; en attente : somme
   * séquentielle de ce qui la précède + sa propre durée). null = « estimation indisponible ».
   */
  eta_s: number | null;
  /** Fourchette p10–p90 mesurée par validation croisée (en cours seulement, ≥ 4 analyses). */
  eta_range_s: [number, number] | null;
  /** Pourquoi `eta_s` est null (en cours ou en attente) ; null sinon. */
  eta_reason: EtaReason | null;
  /** En cours depuis plus longtemps que prévu : `eta_s` vaut 0 sans que la fin soit proche. */
  eta_overrun: boolean;
};

export type ViewContext = {
  now: number;
  concurrency: number;
  /** État de la file de ce serveur ; null si elle n'existe pas encore (rien n'a été lancé). */
  queue: { active: string[]; waiting: string[] } | null;
  /** Moteur demandé des analyses lancées dont `session.json` ne le porte pas encore. */
  pendingEngines?: Record<string, string>;
};

type Total = {
  total_s: number | null;
  low_s: number | null;
  high_s: number | null;
  reason: EtaReason | null;
};

const engineOf = (s: Session): string | null => s.engine ?? s.asr ?? null;
const positive = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && value > 0;

function historyPoints(sessions: Session[]): HistoryPoint[] {
  const points: HistoryPoint[] = [];
  for (const s of sessions) {
    const engine = engineOf(s);
    if (
      s.state === "done" &&
      engine &&
      positive(s.audio_duration_s) &&
      positive(s.duration_s)
    )
      points.push({
        engine,
        audio_s: s.audio_duration_s,
        duration_s: s.duration_s,
      });
  }
  return points;
}

function fitter(points: HistoryPoint[]) {
  const cache = new Map<string, ReturnType<typeof fitEngine>>();
  return (engine: string) => {
    let result = cache.get(engine);
    if (!result) {
      result = fitEngine(points.filter((p) => p.engine === engine));
      cache.set(engine, result);
    }
    return result;
  };
}

/** Durée totale attendue d'une analyse (de son départ à sa fin), ou la raison de son absence. */
function totalFor(
  s: Session,
  fit: ReturnType<ReturnType<typeof fitter>>,
): Total {
  const none = (reason: EtaReason): Total => ({
    total_s: null,
    low_s: null,
    high_s: null,
    reason,
  });
  if (!positive(s.audio_duration_s)) return none("audio_duration_unknown");
  if (!fit.ok) return none(fit.reason);
  const p = predictTotal(fit.fit, s.audio_duration_s);
  if (p.out_of_range) return none("out_of_range");
  return { total_s: p.total_s, low_s: p.low_s, high_s: p.high_s, reason: null };
}

export function buildViews(
  sessions: Session[],
  ctx: ViewContext,
): SessionView[] {
  const fitFor = fitter(historyPoints(sessions));
  const totals = new Map<string, Total>();
  const total = (s: Session): Total => {
    let t = totals.get(s.id);
    if (!t) {
      const engine = engineOf(s) ?? ctx.pendingEngines?.[s.id] ?? null;
      t = engine
        ? totalFor(s, fitFor(engine))
        : { total_s: null, low_s: null, high_s: null, reason: "no_history" };
      totals.set(s.id, t);
    }
    return t;
  };

  const known = new Map(sessions.map((s) => [s.id, s]));
  const queued = sessions.filter((s) => s.state === "queued");
  const knownWaiting = (ctx.queue?.waiting ?? []).filter((id) => known.has(id));
  const unseen = queued
    .filter((s) => !knownWaiting.includes(s.id))
    .sort(
      (a, b) =>
        (a.queued_at ?? a.created_at).localeCompare(
          b.queued_at ?? b.created_at,
        ) || a.id.localeCompare(b.id),
    )
    .map((s) => s.id);
  const waitingIds = [...knownWaiting, ...unseen];
  const position = new Map(waitingIds.map((id, i) => [id, i + 1]));

  // En cours : l'état « running », plus ce que la file vient de lancer (processus pas encore écrit).
  const runningSessions = sessions.filter(
    (s) =>
      s.state === "running" ||
      ((s.state === "queued" || s.state === "ready") &&
        ctx.queue?.active.includes(s.id)),
  );
  const elapsed = (s: Session) =>
    s.state === "running" ? (elapsedSeconds(s.started_at, ctx.now) ?? 0) : 0;
  const remaining = (s: Session): number | null => {
    const t = total(s);
    return t.total_s === null ? null : Math.max(0, t.total_s - elapsed(s));
  };
  const eta = projectQueue(
    runningSessions.map((s) => ({ id: s.id, remaining_s: remaining(s) })),
    waitingIds.map((id) => ({
      id,
      total_s: total(known.get(id) as Session).total_s,
    })),
    ctx.concurrency,
  );

  return sessions.map((s): SessionView => {
    const view: SessionView = {
      ...s,
      queue_position: position.get(s.id) ?? null,
      unread: isUnread(s),
      elapsed_s:
        s.state === "running" ? elapsedSeconds(s.started_at, ctx.now) : null,
      eta_s: null,
      eta_range_s: null,
      eta_reason: null,
      eta_overrun: false,
    };
    const isRunning = runningSessions.includes(s);
    const isWaiting = position.has(s.id);
    if (!isRunning && !isWaiting) return view;
    const own = total(s);
    const projected = eta.get(s.id) ?? null;
    view.eta_s = projected;
    if (projected === null) view.eta_reason = own.reason ?? "ahead_unknown";
    if (isRunning && own.total_s !== null) {
      const spent = elapsed(s);
      view.eta_overrun = own.total_s - spent < 0;
      if (own.low_s !== null && own.high_s !== null)
        view.eta_range_s = [
          Math.max(0, own.low_s - spent),
          Math.max(0, own.high_s - spent),
        ];
    }
    return view;
  });
}

export type EngineStats = {
  engine: string;
  /** Analyses réussies, seules à compter dans les durées. */
  analyses: number;
  failures: number;
  audio_total_s: number;
  processing_total_s: number;
  /** Durée de traitement / durée audio : médiane, p90, moyenne, extrêmes (la dispersion se voit). */
  rtf: RtfStats | null;
  /** Modèle d'estimation : durée = overhead_s + seconds_per_audio_s × audio (voir estimate.ts). */
  estimate: Pick<
    Fit,
    | "samples"
    | "overhead_s"
    | "seconds_per_audio_s"
    | "audio_max_s"
    | "loo_median_rel_error"
  > | null;
  estimate_unavailable: EstimateRefusal | null;
};

export type Stats = {
  generated_at: string;
  queue: {
    concurrency: number;
    running: Array<{
      id: string;
      name: string;
      engine: string | null;
      started_at: string | null;
      elapsed_s: number | null;
      eta_s: number | null;
    }>;
    waiting: Array<{
      id: string;
      name: string;
      engine: string | null;
      queue_position: number;
      eta_s: number | null;
    }>;
  };
  engines: EngineStats[];
  recent: Array<{
    id: string;
    name: string;
    engine: string | null;
    state: Session["state"];
    audio_duration_s: number | null;
    duration_s: number | null;
    rtf: number | null;
    finished_at: string | null;
    unread: boolean;
  }>;
};

const RECENT = 10;

export function buildStats(sessions: Session[], ctx: ViewContext): Stats {
  const views = buildViews(sessions, ctx);
  const points = historyPoints(sessions);
  // Une analyse = lancée par l'atelier (`started_at`) ; un résultat importé à la main n'en est pas une.
  const ran = (s: Session, state: Session["state"]) =>
    s.state === state && (state === "failed" || s.started_at !== null);
  const engines = new Set<string>();
  for (const s of sessions)
    if ((ran(s, "done") || ran(s, "failed")) && engineOf(s))
      engines.add(engineOf(s) as string);
  const perEngine: EngineStats[] = [...engines].map((engine) => {
    const mine = points.filter((p) => p.engine === engine);
    const fit = fitEngine(mine);
    return {
      engine,
      analyses: sessions.filter((s) => ran(s, "done") && engineOf(s) === engine)
        .length,
      failures: sessions.filter(
        (s) => ran(s, "failed") && engineOf(s) === engine,
      ).length,
      audio_total_s: sessions
        .filter((s) => ran(s, "done") && engineOf(s) === engine)
        .reduce(
          (sum, s) =>
            sum + (positive(s.audio_duration_s) ? s.audio_duration_s : 0),
          0,
        ),
      processing_total_s: mine.reduce((sum, p) => sum + p.duration_s, 0),
      rtf: rtfStats(mine),
      estimate: fit.ok
        ? {
            samples: fit.fit.samples,
            overhead_s: fit.fit.overhead_s,
            seconds_per_audio_s: fit.fit.seconds_per_audio_s,
            audio_max_s: fit.fit.audio_max_s,
            loo_median_rel_error: fit.fit.loo_median_rel_error,
          }
        : null,
      estimate_unavailable: fit.ok ? null : fit.reason,
    };
  });
  perEngine.sort(
    (a, b) => b.analyses - a.analyses || a.engine.localeCompare(b.engine),
  );

  const running = views.filter(
    (v) => v.state === "running" || (ctx.queue?.active.includes(v.id) ?? false),
  );
  const waiting = views
    .filter((v) => v.queue_position !== null)
    .sort(
      (a, b) => (a.queue_position as number) - (b.queue_position as number),
    );
  const finishedAt = (s: Session) => s.finished_at ?? s.created_at;
  const recent = views
    .filter((v) => ran(v, "done") || ran(v, "failed"))
    .sort((a, b) => finishedAt(b).localeCompare(finishedAt(a)))
    .slice(0, RECENT)
    .map((v) => ({
      id: v.id,
      name: v.name,
      engine: engineOf(v),
      state: v.state,
      audio_duration_s: v.audio_duration_s ?? null,
      duration_s: v.duration_s ?? null,
      rtf:
        positive(v.audio_duration_s) && positive(v.duration_s)
          ? v.duration_s / v.audio_duration_s
          : null,
      finished_at: v.finished_at,
      unread: v.unread,
    }));

  return {
    generated_at: new Date(ctx.now).toISOString(),
    queue: {
      concurrency: ctx.concurrency,
      running: running.map((v) => ({
        id: v.id,
        name: v.name,
        engine: engineOf(v),
        started_at: v.started_at,
        elapsed_s: v.elapsed_s,
        eta_s: v.eta_s,
      })),
      waiting: waiting.map((v) => ({
        id: v.id,
        name: v.name,
        engine: engineOf(v),
        queue_position: v.queue_position as number,
        eta_s: v.eta_s,
      })),
    },
    engines: perEngine,
    recent,
  };
}

/** Contexte courant du serveur (file réelle, concurrence configurée, horloge). */
export function currentContext(): ViewContext {
  return {
    now: Date.now(),
    concurrency: maxConcurrent(),
    queue: peekQueue()?.snapshot() ?? null,
    pendingEngines: pendingEngines(),
  };
}

/** Sessions lues sur le disque, avec migration paresseuse des champs de durée. */
async function loadSessions(): Promise<Session[]> {
  return Promise.all((await listSessions()).map((s) => backfillDerived(s)));
}

export async function listSessionViews(): Promise<SessionView[]> {
  return buildViews(await loadSessions(), currentContext());
}

/** Une session (avec son estimation, qui dépend de l'historique de toutes les autres). */
export async function readSessionView(id: string): Promise<SessionView> {
  const session = await backfillDerived(await readSession(id));
  const others = (await loadSessions()).filter((s) => s.id !== id);
  const view = buildViews([...others, session], currentContext()).find(
    (v) => v.id === id,
  );
  return view as SessionView;
}

export async function readStats(): Promise<Stats> {
  return buildStats(await loadSessions(), currentContext());
}
