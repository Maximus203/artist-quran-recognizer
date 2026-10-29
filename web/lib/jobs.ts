import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseAsrChoice, type AsrChoice } from "./asr-choice";
import { describeFailure, isMissingSession } from "./errors";
import { recognizeCommand } from "./python";
import {
  JobQueue,
  peekQueue,
  sharedQueue,
  type JobSignal,
  type QueueEntry,
} from "./queue";
import { parseRecognition, type Recognition } from "./recognition";
import {
  REPO,
  audioPath,
  deleteSession,
  jobs,
  listSessions,
  readSession,
  recordOutcome,
  saveSession,
  sessionDir,
  sha,
  UPDATE,
  type Session,
} from "./store";

const ASR_ENGINES = ["cascade", "fastconformer", "whisper", "muno-streaming"];
/** Moteur de l'atelier : la cascade par défaut ; `AQR_ASR` force un moteur seul (avancé). */
export const ASR_ENGINE = ASR_ENGINES.includes(process.env.AQR_ASR ?? "")
  ? (process.env.AQR_ASR as string)
  : "cascade";

/**
 * Analyses lancées en même temps (`AQR_MAX_CONCURRENT`, 1 par défaut : la carte graphique n'aime
 * pas le parallèle). Lue à chaque démarrage ; une valeur invalide retombe sur 1.
 */
export function maxConcurrent(
  raw: string | undefined = process.env.AQR_MAX_CONCURRENT,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
}

/** Jobs en attente autorisés par compte (`AQR_MAX_WAITING_PER_USER`, 5 par défaut). */
export function maxWaitingPerUser(
  raw: string | undefined = process.env.AQR_MAX_WAITING_PER_USER,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 1 ? value : 5;
}

/**
 * Délai maximal d'une analyse avant arrêt par le watchdog : `AQR_JOB_TIMEOUT_S` si renseigné, sinon
 * huit fois la durée de l'audio, au moins 30 minutes.
 */
export function analysisTimeoutMs(
  audioDurationS: number | null | undefined,
  raw: string | undefined = process.env.AQR_JOB_TIMEOUT_S,
): number {
  const forced = Number(raw);
  if (Number.isFinite(forced) && forced > 0) return forced * 1000;
  const audio = audioDurationS && audioDurationS > 0 ? audioDurationS : 0;
  return Math.max(30 * 60, audio * 8) * 1000;
}

/**
 * État mutable des lancements, partagé par tout le processus serveur (sur `globalThis`, comme la
 * file et la table des traitements) : Next peut charger ce module dans plusieurs bundles (routes et
 * `instrumentation.ts`) alors que la file n'exécute qu'avec la copie qui l'a créée.
 */
type Shared = {
  /** Moteur demandé pour une analyse qui n'a pas encore démarré (relu de `session.asr` sinon). */
  requestedAsr: Map<string, AsrChoice>;
  /** Mise en file demandée, pas encore exécutée (valeur de `queued_at` décidée au lancement). */
  requestedQueuedAt: Map<string, string>;
  /** Lancements en cours de validation : la reprise après redémarrage ne doit pas les doubler. */
  launching: Set<string>;
  /** Annulations arrivées entre « sorti de la file » et « processus lancé ». */
  cancelRequests: Set<string>;
  /**
   * Processus d'un serveur précédent encore vivants : ils tiennent la carte graphique sans que la
   * file les possède. Ils comptent comme des places occupées jusqu'à leur fin.
   */
  orphanPids: Set<number>;
  orphanTimer?: ReturnType<typeof setInterval>;
  launchTail: Promise<unknown>;
  lastQueuedAt: number;
};
const SHARED = Symbol.for("aqr.job-state");
function shared(): Shared {
  const holder = globalThis as { [SHARED]?: Shared };
  return (holder[SHARED] ??= {
    requestedAsr: new Map(),
    requestedQueuedAt: new Map(),
    launching: new Set(),
    cancelRequests: new Set(),
    orphanPids: new Set(),
    launchTail: Promise.resolve(),
    lastQueuedAt: 0,
  });
}

/** Moteur demandé des analyses lancées pas encore écrites dans `session.json` (lecture seule). */
export function pendingEngines(): Record<string, string> {
  return Object.fromEntries(shared().requestedAsr);
}

/** Exécute `task` après tous les lancements précédents (FIFO), qu'ils réussissent ou non. */
function serialized<T>(task: () => Promise<T>): Promise<T> {
  const state = shared();
  const result = state.launchTail.then(task, task);
  state.launchTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
/** Horodatage de mise en file strictement croissant (sans égalité à la milliseconde). */
function nextQueuedAt(): string {
  const state = shared();
  state.lastQueuedAt = Math.max(Date.now(), state.lastQueuedAt + 1);
  return new Date(state.lastQueuedAt).toISOString();
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function liveOrphans(): number {
  const { orphanPids } = shared();
  for (const pid of orphanPids) if (!isAlive(pid)) orphanPids.delete(pid);
  return orphanPids.size;
}
function watchOrphans(pids: number[]): void {
  const state = shared();
  for (const pid of pids) state.orphanPids.add(pid);
  if (state.orphanTimer || state.orphanPids.size === 0) return;
  state.orphanTimer = setInterval(() => {
    if (liveOrphans() === 0) {
      clearInterval(state.orphanTimer);
      state.orphanTimer = undefined;
    }
    peekQueue()?.pump();
  }, 5000);
  state.orphanTimer.unref();
}

/** Marque en échec une analyse dont le démarrage a échoué avant toute issue (jamais une annulée). */
async function markFailed(id: string, error: unknown): Promise<void> {
  try {
    const session = await readSession(id);
    if (session.state !== "queued" && session.state !== "running") return;
    session.state = "failed";
    session.error = describeFailure(error, "Lancement impossible");
    session.pid = null;
    recordOutcome(session, null, new Date().toISOString());
    await saveSession(session, UPDATE);
  } catch {
    /* session supprimée entre-temps : rien à consigner */
  }
}

/** La file du processus (créée à la demande, une seule même si le module est chargé deux fois). */
export function jobQueue(): JobQueue {
  return sharedQueue(
    () =>
      new JobQueue({
        runner: execute,
        concurrency: () => maxConcurrent(),
        externalBusy: liveOrphans,
        maxWaitingPerOwner: () => maxWaitingPerUser(),
        onError: (id, error) => void markFailed(id, error),
      }),
  );
}

export type LaunchResult = {
  state: Session["state"];
  queue_position: number | null;
};

/**
 * Met l'analyse en file. Si une place est libre, elle démarre aussitôt (et `launch` attend que le
 * processus soit lancé) ; sinon la session passe `queued`, avec son ordre persistant (`queued_at`),
 * et `launch` rend la main tout de suite.
 */
export async function launch(
  id: string,
  requestedEngine?: AsrChoice,
  /** Compte demandeur (équité de la file) ; absent : la tâche compte pour elle seule. */
  owner?: number | null,
): Promise<LaunchResult> {
  const asr = parseAsrChoice(requestedEngine ?? ASR_ENGINE);
  const queue = jobQueue();
  // Un lancement à la fois, dans l'ordre d'arrivée : `queued_at` (ordre durable) et le rang dans la
  // file se décident au même endroit, donc ne peuvent pas se contredire. Deux lancements du même
  // identifiant ne passent pas ensemble ; une session annulée n'est relançable qu'après son `close`.
  const entry = await serialized(async (): Promise<QueueEntry> => {
    const session = await readSession(id);
    if (session.state === "running")
      throw new Error("Traitement déjà en cours");
    if (session.state === "done")
      throw new Error("Un résultat existe déjà ; crée une nouvelle session.");
    if (!process.env.AQR_MODELS_DIR)
      throw new Error(
        "AQR_MODELS_DIR absent : les poids du moteur ne sont pas configurés sur cette machine.",
      );
    // L'audio doit exister avant de promettre une place (la session, elle, vient d'être lue).
    await audioPath(id).catch((error) => {
      throw isMissingSession(error)
        ? new Error(
            "Le fichier audio de cette session est introuvable sur le disque.",
          )
        : error;
    });
    if (jobs.has(id) || queue.has(id))
      throw new Error(
        "Traitement déjà en cours ou en file d'attente : réessaie dans un instant.",
      );
    shared().launching.add(id);
    try {
      const queuedAt = nextQueuedAt();
      shared().requestedAsr.set(id, asr);
      shared().requestedQueuedAt.set(id, queuedAt);
      if (!queue.wouldStartNow()) {
        // Persisté avant d'entrer dans la file : l'ordre survit à un redémarrage du serveur.
        session.state = "queued";
        session.asr = asr;
        session.engine = asr;
        session.error = null;
        session.queued_at = queuedAt;
        await saveSession(session, UPDATE);
      }
      return queue.enqueue(id, {
        owner: owner == null ? undefined : String(owner),
        timeoutMs: analysisTimeoutMs(session.audio_duration_s),
      });
    } catch (error) {
      shared().requestedAsr.delete(id);
      shared().requestedQueuedAt.delete(id);
      throw error;
    } finally {
      shared().launching.delete(id);
    }
  });
  if (!queue.isActive(id))
    return { state: "queued", queue_position: queue.position(id) };
  await entry.started;
  return {
    state: (await readSession(id)).state,
    queue_position: queue.position(id),
  };
}

/** Exécuteur de la file : lance le processus et ne rend la main qu'à sa fin (place gardée). */
async function execute(id: string, signal: JobSignal): Promise<void> {
  try {
    await run(id, signal);
  } finally {
    shared().requestedAsr.delete(id);
    shared().requestedQueuedAt.delete(id);
    shared().cancelRequests.delete(id);
  }
}

async function run(id: string, signal: JobSignal): Promise<void> {
  const session = await readSession(id);
  // Une analyse terminée ou déjà lancée ne repart pas ; prête, en échec ou annulée, oui.
  if (session.state === "done" || session.state === "running") return;
  const asr = parseAsrChoice(
    shared().requestedAsr.get(id) ?? session.asr ?? ASR_ENGINE,
  );
  const models = process.env.AQR_MODELS_DIR;
  if (!models)
    throw new Error(
      "AQR_MODELS_DIR absent : les poids du moteur ne sont pas configurés sur cette machine.",
    );
  const source = await audioPath(id),
    output = sessionDir(id);
  if (shared().cancelRequests.has(id)) {
    // Annulée entre la sortie de file et le lancement : rien à tuer, on consigne seulement.
    session.state = "cancelled";
    session.pid = null;
    await saveSession(session, UPDATE);
    return;
  }
  const { command, args, env } = recognizeCommand(source, output, asr, models);
  if (jobs.has(id))
    throw new Error(
      "Traitement déjà en cours ou en cours d'arrêt : réessaie dans un instant.",
    );
  const child = spawn(/* turbopackIgnore: true */ command, args, {
    cwd: REPO,
    shell: false,
    windowsHide: true,
    env,
  });
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => (settle = resolve));
  jobs.set(id, { child, settled });
  let aborted = false;
  // Watchdog : le délai dépassé tue le processus et consigne un échec lisible.
  signal.aborted.addEventListener(
    "abort",
    () => {
      if (aborted || shared().cancelRequests.has(id)) return;
      void readSession(id)
        .then(async (current) => {
          if (current.state !== "running") return;
          aborted = true;
          child.kill();
          current.state = "failed";
          current.error =
            "L’analyse a dépassé le délai maximal et a été arrêtée. Réessaie, ou découpe l’enregistrement.";
          current.pid = null;
          recordOutcome(current, null, new Date().toISOString());
          await saveSession(current, UPDATE);
        })
        .catch(() => undefined);
    },
    { once: true },
  );
  let outputText = "";
  session.state = "running";
  session.asr = asr;
  session.engine = asr;
  session.error = null;
  session.queued_at =
    shared().requestedQueuedAt.get(id) ?? session.queued_at ?? nextQueuedAt();
  session.started_at = new Date().toISOString();
  session.finished_at = null;
  session.duration_s = null;
  session.pid = child.pid || null;
  // Écrit avant toute issue : `close` l'attend, sinon il pourrait être écrasé par « running ».
  const started = saveSession(session, UPDATE);
  // Écouteurs posés avant tout `await` : un `error` de spawn (interpréteur introuvable)
  // arrive au tick suivant et serait sinon une exception non interceptée.
  child.stdout?.on("data", (chunk: Buffer) => {
    outputText = (outputText + chunk.toString()).slice(-8000);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    outputText = (outputText + chunk.toString()).slice(-8000);
  });
  child.on("error", (error) => {
    outputText = error.message;
  });
  child.on("close", async (code) => {
    try {
      await started.catch(() => undefined);
      if (aborted) return;
      const current = await readSession(id);
      if (current.state === "cancelled") return;
      current.pid = null;
      const finishedAt = new Date().toISOString();
      let parsed: Recognition | null = null;
      if (code === 0) {
        const raw = await readFile(
          path.join(output, `source.recognition.json`),
        );
        parsed = parseRecognition(JSON.parse(raw.toString("utf8")));
        if (parsed.source.sha256.toLowerCase() !== current.audio_sha256)
          throw new Error("Hash audio de sortie incohérent");
        await writeFile(path.join(output, "prediction.recognition.json"), raw);
        current.prediction_sha256 = sha(raw);
        current.state = "done";
      } else {
        const detail = outputText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .at(-1);
        current.state = "failed";
        current.error = `Reconnaissance interrompue avant la production d’un résultat. ${detail || "Vérifie les modèles, le corpus et le format audio."}`;
      }
      recordOutcome(current, parsed, finishedAt);
      await saveSession(current, UPDATE);
    } catch (error) {
      try {
        const current = await readSession(id);
        current.state = "failed";
        current.error = describeFailure(error, "Résultat invalide");
        current.pid = null;
        recordOutcome(current, null, new Date().toISOString());
        await saveSession(current, UPDATE);
      } catch {
        /* session supprimée entre-temps : rien à consigner */
      }
    } finally {
      // Libère le job seulement maintenant : jusque-là, aucun lecteur ne sonde le processus.
      if (jobs.get(id)?.child === child) jobs.delete(id);
      settle();
    }
  });
  try {
    await started;
  } catch (error) {
    aborted = true;
    child.kill();
    session.state = "failed";
    session.error = describeFailure(error, "Lancement impossible");
    session.pid = null;
    recordOutcome(session, null, new Date().toISOString());
    await saveSession(session, UPDATE).catch(() => undefined);
    if (jobs.get(id)?.child === child) jobs.delete(id);
    settle();
    throw error;
  }
  signal.started();
  await settled;
}

/** Se résout quand le gestionnaire `close` du traitement de `id` a fini (immédiat sans traitement). */
export function jobSettled(id: string): Promise<void> {
  return jobs.get(id)?.settled ?? peekQueue()?.settled(id) ?? Promise.resolve();
}

/**
 * Annule une analyse : en attente, elle quitte la file sans jamais démarrer ; en cours, son
 * processus est tué. Une annulation n'est jamais écrasée par la fin du processus.
 */
export function cancel(id: string): Promise<void> {
  // Dans l'ordre des lancements : un « annule » puis un « relance » (ou l'inverse) se lisent comme ils
  // ont été envoyés, jamais entremêlés.
  return serialized(() => cancelNow(id));
}
async function cancelNow(id: string): Promise<void> {
  const queue = peekQueue();
  if (queue?.remove(id)) {
    await markCancelled(id);
    return;
  }
  const job = jobs.get(id);
  if (!job) {
    if (queue?.isActive(id)) {
      shared().cancelRequests.add(id);
      return;
    }
    // « queued » sur le disque, mais inconnue de la file (serveur redémarré, pas encore reprise).
    if ((await readSession(id)).state === "queued") {
      await markCancelled(id);
      return;
    }
    throw new Error("Aucun traitement actif dans ce serveur");
  }
  const session = await readSession(id);
  session.state = "cancelled";
  session.pid = null;
  session.finished_at = new Date().toISOString();
  await saveSession(session, UPDATE);
  job.child.kill();
}
async function markCancelled(id: string): Promise<void> {
  const session = await readSession(id);
  session.state = "cancelled";
  session.pid = null;
  session.finished_at = new Date().toISOString();
  await saveSession(session, UPDATE);
}

/** Supprime une session dans l'ordre des lancements (voir `cancel`) ; mêmes refus que le stockage. */
export function removeSession(
  id: string,
  options: { force?: boolean } = {},
): Promise<void> {
  return serialized(() => deleteSession(id, options));
}

/**
 * Remet en file les analyses `queued` que ce serveur ne connaît pas (redémarrage), dans l'ordre de
 * `queued_at`, et note les processus d'un serveur précédent encore en cours (ils retiennent la
 * place). Idempotent : une analyse déjà en file n'est jamais doublée.
 */
export async function recoverQueue(): Promise<string[]> {
  const sessions = await listSessions();
  watchOrphans(
    sessions
      .filter(
        (s) =>
          s.state === "running" && s.pid && !jobs.has(s.id) && isAlive(s.pid),
      )
      .map((s) => s.pid as number),
  );
  const queue = jobQueue();
  const waiting = sessions
    .filter(
      (s) =>
        s.state === "queued" &&
        !queue.has(s.id) &&
        !shared().launching.has(s.id),
    )
    .sort(
      (a, b) =>
        (a.queued_at ?? a.created_at).localeCompare(
          b.queued_at ?? b.created_at,
        ) ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    );
  for (const s of waiting)
    queue.enqueue(s.id, { timeoutMs: analysisTimeoutMs(s.audio_duration_s) });
  return waiting.map((s) => s.id);
}

const RECOVERED = Symbol.for("aqr.queue-recovered");
/** Reprise faite une seule fois par processus (au démarrage ou à la première requête). */
export function ensureQueueRecovered(): Promise<string[]> {
  const holder = globalThis as { [RECOVERED]?: Promise<string[]> };
  holder[RECOVERED] ??= recoverQueue().catch((error) => {
    delete holder[RECOVERED]; // réessayée à la requête suivante
    throw error;
  });
  return holder[RECOVERED];
}
/** Pour les tests : autorise une nouvelle reprise. */
export function resetQueueRecovery(): void {
  delete (globalThis as { [RECOVERED]?: unknown })[RECOVERED];
}
