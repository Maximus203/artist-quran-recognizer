import type { ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AsrChoice } from "./asr-choice";
import { LISTENING } from "./listening";
import { log } from "./log";
import { peekQueue } from "./queue";
import { parseRecognition, type Recognition } from "./recognition";
import { reviewSchema, type Review } from "./review";
import { realDurationSeconds, sessionEngine } from "./session-meta";

/** Dossier de données par défaut : AppData seulement sous Windows, XDG ailleurs. */
export function defaultReviewDir(
  platform: NodeJS.Platform,
  home: string,
  env: Record<string, string | undefined>,
): string {
  if (platform === "win32")
    return path.join(home, "AppData", "Local", "aqr-review");
  const base = env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(base, "aqr-review");
}
/** Lu à chaque appel (testable, et cohérent si l'environnement change). */
export function reviewRoot(): string {
  return path.resolve(
    /* turbopackIgnore: true */ process.env.AQR_REVIEW_DIR ||
      defaultReviewDir(process.platform, os.homedir(), process.env),
  );
}
const DEFAULT_UPLOAD_BYTES = 500 * 1024 * 1024;
/** Plafond d'upload en octets (`AQR_MAX_UPLOAD_BYTES`, 500 Mo par défaut). */
export function uploadLimitBytes(
  raw: string | undefined = process.env.AQR_MAX_UPLOAD_BYTES,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_UPLOAD_BYTES;
}
const DEFAULT_VIDEO_UPLOAD_BYTES = 2 * 1024 ** 3;
/**
 * Plafond d'une vidéo envoyée en flux (`AQR_MAX_VIDEO_UPLOAD_BYTES`, 2 Gio par défaut). Plus haut
 * que celui de l'audio parce qu'on garde l'image alors que seule la piste sonore sert : 2 Gio
 * couvrent une heure et demie de 1080p courant. Un flux va directement sur le disque ; le
 * formulaire multipart, lui, est lu en mémoire et reste soumis à `uploadLimitBytes`.
 */
export function videoUploadLimitBytes(
  raw: string | undefined = process.env.AQR_MAX_VIDEO_UPLOAD_BYTES,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_VIDEO_UPLOAD_BYTES;
}
/** Rejet précoce d'après `Content-Length` (marge pour l'enveloppe multipart). */
export function exceedsUploadLimit(
  contentLength: string | null,
  limit = uploadLimitBytes(),
): boolean {
  if (contentLength === null) return false;
  const declared = Number(contentLength);
  return !Number.isFinite(declared) || declared > limit + 2 * 1024 * 1024;
}
/** Durée d'inactivité avant nettoyage (`AQR_SESSION_TTL_S`) ; 0 = jamais (défaut). */
export function sessionTtlSeconds(
  raw: string | undefined = process.env.AQR_SESSION_TTL_S,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : 0;
}
export const REPO = path.resolve(process.cwd(), "..");
/** Traitement lancé par ce serveur ; `settled` se résout quand `close` a consigné l'issue. */
export type Job = { child: ChildProcess; settled: Promise<void> };
/**
 * Traitements en cours dans ce serveur. Tant qu'un id y figure, seul le gestionnaire
 * `close` de `jobs.ts` consigne l'issue : `readSession` ne sonde pas le processus.
 */
const JOBS_KEY = Symbol.for("aqr.jobs");
/** Sur `globalThis` : une seule table par processus serveur, même si le module est chargé deux fois. */
export const jobs: Map<string, Job> = ((
  globalThis as { [JOBS_KEY]?: Map<string, Job> }
)[JOBS_KEY] ??= new Map<string, Job>());
export type Session = {
  id: string;
  name: string;
  extension: string;
  audio_sha256: string;
  size: number;
  source_kind?: "file" | "microphone";
  asr?: AsrChoice;
  created_at: string;
  /** `queued` : en attente de la file (voir `queue.ts`) ; `running` : le processus tourne. */
  state: "ready" | "queued" | "running" | "done" | "failed" | "cancelled";
  error: string | null;
  /** Mise en file (reste renseignée après le départ : sert d'ordre FIFO au redémarrage). */
  queued_at?: string | null;
  started_at: string | null;
  finished_at: string | null;
  prediction_sha256: string | null;
  pid: number | null;
  /** Moteur de l'analyse (`cascade`, `fastconformer`…), identique à `asr` pour les nouvelles sessions. */
  engine?: AsrChoice | null;
  /** Durée de l'audio en secondes : sonde à l'import, puis valeur du moteur à la fin. */
  audio_duration_s?: number | null;
  /** Durée réelle du traitement (fin − départ) ; sert à estimer les analyses suivantes. */
  duration_s?: number | null;
  /**
   * Date d'ouverture du résultat. `null` = terminé mais jamais ouvert (non lu) ; champ absent =
   * session d'avant le suivi, considérée lue.
   */
  viewed_at?: string | null;
};
/**
 * Crochets d'observation (motif Observer) : la couche données (`session-sync.ts`) s'y branche pour
 * suivre les sessions dans la base SQLite sans que ce module la connaisse. Un crochet qui échoue
 * est journalisé et ne fait jamais échouer l'écriture de `session.json`.
 */
export type SessionHooks = {
  saved?: (session: Session) => Promise<void> | void;
  removed?: (id: string) => Promise<void> | void;
};
const HOOKS_KEY = Symbol.for("aqr.session-hooks");
export const sessionHooks: SessionHooks = ((
  globalThis as { [HOOKS_KEY]?: SessionHooks }
)[HOOKS_KEY] ??= {});
async function notifySaved(session: Session): Promise<void> {
  try {
    await sessionHooks.saved?.(session);
  } catch (error) {
    log.error("store", "suivi de la session en échec", error);
  }
}
async function notifyRemoved(id: string): Promise<void> {
  try {
    await sessionHooks.removed?.(id);
  } catch (error) {
    log.error("store", "retrait de la session de l'index en échec", error);
  }
}
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function sha(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
export function sessionDir(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error("Identifiant invalide");
  return path.join(reviewRoot(), "sessions", id);
}
/** Refus passagers de Windows quand le fichier remplacé est ouvert en lecture au même instant. */
const TRANSIENT_RENAME = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_ATTEMPTS = 8;
/** Option de `saveSession` pour mettre à jour une session existante sans jamais la recréer. */
export const UPDATE = { create: false } as const;
export async function atomicJson(
  file: string,
  value: unknown,
  { createDir = true }: { createDir?: boolean } = {},
): Promise<void> {
  if (createDir) await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  // Sans cette reprise, une lecture concurrente (sondage de la liste) pouvait faire perdre la
  // fin d'une analyse : la session restait « en attente » ou « en cours » pour toujours.
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(temp, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (attempt >= RENAME_ATTEMPTS || !TRANSIENT_RENAME.has(code)) {
        await rm(temp, { force: true }).catch(() => undefined);
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 10 * attempt));
    }
  }
}
/**
 * Consigne l'issue d'une analyse : fin, durée réelle, durée de l'audio et moteur d'après la sortie
 * du moteur (la valeur du moteur remplace la sonde de l'import), et résultat « non lu ».
 * Partagé par le gestionnaire `close` (jobs.ts) et par l'adoption d'une sortie trouvée sur le disque.
 */
export function recordOutcome(
  value: Session,
  parsed: Recognition | null,
  finishedAt: string,
): void {
  value.finished_at = finishedAt;
  value.duration_s = realDurationSeconds(value.started_at, finishedAt);
  if (parsed) {
    value.audio_duration_s = parsed.source.duration_s;
    value.engine = sessionEngine(value, parsed.engine.asr);
  }
  value.viewed_at = null;
}
export async function readSession(id: string): Promise<Session> {
  const value = JSON.parse(
    await readFile(path.join(sessionDir(id), "session.json"), "utf8"),
  ) as Session;
  if (value.state !== "running") return value;
  try {
    const raw = await readFile(
      path.join(sessionDir(id), "source.recognition.json"),
    );
    const parsed = parseRecognition(JSON.parse(raw.toString("utf8")));
    if (parsed.source.sha256.toLowerCase() === value.audio_sha256) {
      const target = path.join(sessionDir(id), "prediction.recognition.json");
      await writeFile(target, raw);
      value.state = "done";
      value.prediction_sha256 = sha(raw);
      recordOutcome(value, parsed, new Date().toISOString());
      value.pid = null;
      await saveSession(value, UPDATE);
      return value;
    }
  } catch {
    /* sortie non encore disponible */
  }
  if (value.pid && !jobs.has(id)) {
    try {
      process.kill(value.pid, 0);
    } catch {
      value.state = "failed";
      value.error = "Le traitement s’est arrêté avant de produire un résultat.";
      recordOutcome(value, null, new Date().toISOString());
      value.pid = null;
      await saveSession(value, UPDATE);
    }
  }
  return value;
}
/**
 * Écrit `session.json`. `create: false` pour toute mise à jour d'une session qui existe déjà : si le
 * dossier a été supprimé entre-temps (suppression depuis un autre onglet), l'écriture échoue au
 * lieu de ressusciter un dossier creux avec un seul `session.json`. L'import (création) garde le
 * défaut.
 */
export async function saveSession(
  value: Session,
  { create = true }: { create?: boolean } = {},
): Promise<void> {
  await atomicJson(path.join(sessionDir(value.id), "session.json"), value, {
    createDir: create,
  });
  await notifySaved(value);
}
const locks = new Map<string, Promise<unknown>>();
/** Sérialise les lecture-modification-écriture de `session.json` faites par ce serveur. */
function withSessionLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const next = previous.then(task, task);
  const tail = next.catch(() => undefined);
  locks.set(id, tail);
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return next;
}
/**
 * L'utilisateur a ouvert le résultat : pose `viewed_at` (première ouverture seulement, l'appel est
 * idempotent). Sans effet tant que la session n'est ni terminée ni en échec : rien à lire encore.
 * Un simple `GET` ne passe jamais par ici (le sondage de la liste ne doit pas effacer le point).
 */
export async function markViewed(
  id: string,
  now = new Date(),
): Promise<Session> {
  sessionDir(id); // identifiant invalide : refus avant toute file d'attente
  return withSessionLock(id, async () => {
    const session = await readSession(id);
    if (session.state !== "done" && session.state !== "failed") return session;
    if (typeof session.viewed_at === "string") return session;
    session.viewed_at = now.toISOString();
    await saveSession(session, UPDATE);
    return session;
  });
}
/**
 * Migration paresseuse d'une session terminée avant le suivi des durées : renseigne la durée de
 * l'audio, le moteur et la durée réelle une seule fois (`audio_duration_s` passe de `undefined` à
 * un nombre ou `null`). `viewed_at` n'est pas touché : absent = lu. Ne fait jamais échouer l'appelant.
 */
export async function backfillDerived(session: Session): Promise<Session> {
  if (session.state !== "done" || session.audio_duration_s !== undefined)
    return session;
  return withSessionLock(session.id, async () => {
    const fresh = await readSession(session.id).catch(() => null);
    if (
      !fresh ||
      fresh.state !== "done" ||
      fresh.audio_duration_s !== undefined
    )
      return fresh ?? session;
    let parsed: Recognition | null = null;
    try {
      parsed = (await readResult(fresh.id))?.parsed ?? null;
    } catch {
      /* prédiction illisible : la session reste sans durée, sans casser la liste */
    }
    fresh.audio_duration_s = parsed?.source.duration_s ?? null;
    fresh.engine = sessionEngine(fresh, parsed?.engine.asr);
    fresh.duration_s ??= realDurationSeconds(
      fresh.started_at,
      fresh.finished_at,
    );
    try {
      await saveSession(fresh, UPDATE);
    } catch {
      /* lecture seule : la valeur calculée est quand même renvoyée */
    }
    return fresh;
  });
}
export async function readResult(
  id: string,
): Promise<{ raw: Buffer; parsed: Recognition } | null> {
  try {
    const raw = await readFile(
      path.join(sessionDir(id), "prediction.recognition.json"),
    );
    return { raw, parsed: parseRecognition(JSON.parse(raw.toString("utf8"))) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function readReview(id: string): Promise<Review | null> {
  try {
    return reviewSchema.parse(
      JSON.parse(
        await readFile(path.join(sessionDir(id), "review.json"), "utf8"),
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
const REVISION_SUFFIX = ".review.json";
export async function readReviewHistory(id: string): Promise<Review[]> {
  try {
    const dir = path.join(sessionDir(id), "revisions");
    const files = (await readdir(dir))
      .filter((name) => name.endsWith(REVISION_SUFFIX))
      .sort();
    return Promise.all(
      files.map(async (file) =>
        reviewSchema.parse(
          JSON.parse(await readFile(path.join(dir, file), "utf8")),
        ),
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export async function listSessions(): Promise<Session[]> {
  try {
    const dirs = await readdir(path.join(reviewRoot(), "sessions"));
    const sessions = await Promise.all(
      dirs.map(async (id) => {
        try {
          return await readSession(id);
        } catch {
          return null;
        }
      }),
    );
    return sessions
      .filter((s): s is Session => s !== null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export async function audioPath(id: string): Promise<string> {
  const s = await readSession(id);
  const p = path.join(sessionDir(id), `source${s.extension}`);
  await stat(p);
  return p;
}
/** Refus de supprimer une session qui porte un travail de revue (sans `force`). */
export class ReviewWorkError extends Error {
  constructor() {
    super(
      "Cette session contient un travail de revue (annotations ou révisions) : ajoute ?force=1 pour la supprimer quand même.",
    );
    this.name = "ReviewWorkError";
  }
}
/** Au moins une annotation ou une révision ; une revue illisible compte comme travail. */
async function hasReviewWork(dir: string): Promise<boolean> {
  try {
    const revisions = await readdir(path.join(dir, "revisions"));
    if (revisions.some((name) => name.endsWith(REVISION_SUFFIX))) return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  let raw: string;
  try {
    raw = await readFile(path.join(dir, "review.json"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
  try {
    return reviewSchema.parse(JSON.parse(raw)).annotations.length > 0;
  } catch {
    return true;
  }
}
/**
 * Supprime une session (audio, résultat, revue, exports). Refuse si elle tourne,
 * et refuse si elle porte un travail de revue sauf `force`.
 */
export async function deleteSession(
  id: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  const dir = sessionDir(id);
  const session = await readSession(id);
  const queue = peekQueue();
  // Actif dans la file (processus lancé ou en train de l'être, `running` pas encore écrit) et pas
  // annulé : refus tout de suite. Attendre la fin du moteur ici bloquerait la requête pendant toute
  // l'analyse puis effacerait le résultat.
  const starting = queue?.isActive(id) && session.state !== "cancelled";
  if (session.state === "running" || starting)
    throw new Error("Traitement en cours : annule-le avant de supprimer.");
  if (!force && (await hasReviewWork(dir))) throw new ReviewWorkError();
  // En attente : on la retire de la file avant de supprimer, sinon elle démarrerait sans dossier.
  queue?.remove(id);
  // Session annulée dont `close` n'est pas encore passé : il relirait un dossier supprimé.
  await jobs.get(id)?.settled;
  await rm(dir, { recursive: true, force: true });
  await notifyRemoved(id);
}
/** Copie d'écoute dérivée (`listening.ts`) : régénérable, l'écouter n'est pas une activité. */
export const DERIVED_DIRS = new Set<string>([LISTENING.dir]);
/** Plus grand mtime sous `dir` (dossiers compris). Ne suit pas les liens symboliques. */
async function newestMtimeMs(dir: string): Promise<number> {
  let newest = (await lstat(dir)).mtimeMs;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && DERIVED_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    try {
      newest = Math.max(
        newest,
        entry.isDirectory()
          ? await newestMtimeMs(full)
          : (await lstat(full)).mtimeMs,
      );
    } catch (e) {
      // Fichier renommé ou supprimé pendant le parcours (écriture atomique) : ignoré.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  return newest;
}
/** Date interne exploitable : valide et pas dans le futur (horloge fausse, import). */
function pastTimestampMs(value: unknown, now: number): number {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) && ms <= now ? ms : 0;
}
/**
 * Dernière activité d'une session, en ms : le plus récent entre le mtime de tout
 * fichier ou dossier du dossier de session (session.json, revue, révisions,
 * exports, écritures `.tmp`…), `review.updated_at` et `finished_at`. Seul
 * `session.json` suffisait avant, alors qu'une revue n'écrit que `review.json`.
 * Les dates internes situées après `now` sont ignorées (le mtime reste compté).
 * Une lecture impossible ou un JSON corrompu lève : l'appelant ne doit rien supprimer.
 */
export async function lastActivityMs(
  dir: string,
  now = Date.now(),
): Promise<number> {
  const newest = await newestMtimeMs(dir);
  const session = JSON.parse(
    await readFile(path.join(dir, "session.json"), "utf8"),
  ) as Partial<Session>;
  let reviewedAt = 0;
  try {
    const review = reviewSchema.parse(
      JSON.parse(await readFile(path.join(dir, "review.json"), "utf8")),
    );
    reviewedAt = pastTimestampMs(review.updated_at, now);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return Math.max(
    newest,
    reviewedAt,
    pastTimestampMs(session.finished_at, now),
  );
}
/**
 * Supprime les sessions inactives depuis plus de `maxAgeSeconds` (voir
 * `lastActivityMs` : une revue récente garde la session ET son historique, qui est
 * dans le même dossier). `0` = désactivé. Les sessions en cours sont gardées, tout
 * comme celles dont la lecture échoue. Renvoie les identifiants supprimés.
 */
export async function cleanupSessions(
  maxAgeSeconds: number,
  now = Date.now(),
): Promise<string[]> {
  if (!(maxAgeSeconds > 0)) return [];
  const removed: string[] = [];
  let ids: string[];
  try {
    ids = await readdir(path.join(reviewRoot(), "sessions"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  for (const id of ids) {
    try {
      // Traitement encore possédé par ce serveur (y compris launch → première écriture).
      if (jobs.has(id) || peekQueue()?.has(id)) continue;
      const dir = sessionDir(id);
      const active = async () =>
        now - (await lastActivityMs(dir, now)) < maxAgeSeconds * 1000;
      if (await active()) continue;
      // Une session en attente n'est pas inactive : elle attend son tour dans la file.
      const state = (await readSession(id)).state;
      if (state === "running" || state === "queued") continue;
      // Un PUT de revue a pu écrire depuis la première lecture : relecture juste avant rm.
      if (await active()) continue;
      await rm(dir, { recursive: true, force: true });
      await notifyRemoved(id);
      removed.push(id);
    } catch {
      /* dossier étranger ou illisible : laissé tel quel */
    }
  }
  return removed;
}
