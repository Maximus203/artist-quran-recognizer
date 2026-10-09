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
import { parseRecognition, type Recognition } from "./recognition";
import { reviewSchema, type Review } from "./review";

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
const DEFAULT_UPLOAD_BYTES = 300 * 1024 * 1024;
/** Plafond d'upload en octets (`AQR_MAX_UPLOAD_BYTES`, 300 Mo par défaut). */
export function uploadLimitBytes(
  raw: string | undefined = process.env.AQR_MAX_UPLOAD_BYTES,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_UPLOAD_BYTES;
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
export type Session = {
  id: string;
  name: string;
  extension: string;
  audio_sha256: string;
  size: number;
  source_kind?: "file" | "microphone";
  created_at: string;
  state: "ready" | "running" | "done" | "failed" | "cancelled";
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  prediction_sha256: string | null;
  pid: number | null;
};
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function sha(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
export function sessionDir(id: string): string {
  if (!SESSION_ID.test(id)) throw new Error("Identifiant invalide");
  return path.join(reviewRoot(), "sessions", id);
}
export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temp, file);
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
      value.finished_at = new Date().toISOString();
      value.pid = null;
      await saveSession(value);
      return value;
    }
  } catch {
    /* sortie non encore disponible */
  }
  if (value.pid) {
    try {
      process.kill(value.pid, 0);
    } catch {
      value.state = "failed";
      value.error = "Le traitement s’est arrêté avant de produire un résultat.";
      value.finished_at = new Date().toISOString();
      value.pid = null;
      await saveSession(value);
    }
  }
  return value;
}
export async function saveSession(value: Session): Promise<void> {
  await atomicJson(path.join(sessionDir(value.id), "session.json"), value);
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
  if (session.state === "running")
    throw new Error("Traitement en cours : annule-le avant de supprimer.");
  if (!force && (await hasReviewWork(dir))) throw new ReviewWorkError();
  await rm(dir, { recursive: true, force: true });
}
/** Plus grand mtime sous `dir` (dossiers compris). Ne suit pas les liens symboliques. */
async function newestMtimeMs(dir: string): Promise<number> {
  let newest = (await lstat(dir)).mtimeMs;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
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
      const dir = sessionDir(id);
      const active = async () =>
        now - (await lastActivityMs(dir, now)) < maxAgeSeconds * 1000;
      if (await active()) continue;
      if ((await readSession(id)).state === "running") continue;
      // Un PUT de revue a pu écrire depuis la première lecture : relecture juste avant rm.
      if (await active()) continue;
      await rm(dir, { recursive: true, force: true });
      removed.push(id);
    } catch {
      /* dossier étranger ou illisible : laissé tel quel */
    }
  }
  return removed;
}
