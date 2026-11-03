import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  ClipRejected,
  ffprobeClip,
  inputFormatOf,
  normalizeClip,
  type ClipProbe,
} from "./background-video-media";
import {
  checkClipFile,
  clipExplanation,
  parseClipLimits,
  type ClipCode,
  type ClipLimits,
} from "./background-video-policy";
import {
  chunkBytes,
  chunkStream,
  diskError,
  planChunks,
  receivedIndexes,
  writeChunk,
  type ChunkPlan,
} from "./chunk-staging";
import { freeBytes, wouldFillDisk } from "./disk-space";
import { ImportError, sanitizeName, sniffFile } from "./import-session";
import { log } from "./log";
import type { Sniff } from "./media-sniff";
import { isSessionId } from "./session-id";
import { reviewRoot } from "./store";
import { CLIP_EXTENSIONS } from "./background-video-policy";

/**
 * Vidéo de fond choisie par l'utilisateur, gardée sur le serveur. L'export est rendu côté serveur : un fichier
 * resté sur l'appareil n'atteindrait jamais le rendu. Un envoi par morceaux (reprenable), puis une préparation
 * (image seule : la vidéo de fond est MUETTE ; H.264, 1080p au plus), puis le rendu la lit par son identifiant.
 *
 * Une vidéo appartient à UN compte et à UNE session : l'autre compte, ou une autre session, la voit « inconnue »
 * (404, jamais 403) ; même un administrateur n'y touche pas. Elle disparaît à l'abandon, à la suppression de la
 * session ou du compte, et à l'expiration. Aucun nom de fichier ne vient du client : l'original s'appelle
 * `original<extension reconnue>`, la copie `video.mp4`.
 *
 * `<AQR_REVIEW_DIR>/background-videos/<id>/` : `meta.json` (l'état), les morceaux, puis l'original, puis
 * `video.mp4`. L'état sur disque est la vérité ; la mémoire ne porte que le suivi de la préparation en cours.
 */
export const UPLOAD_TTL_S = 24 * 3600;
/** Une vidéo prête non utilisée depuis 3 jours est retirée ; chaque usage (export, lecture de l'état) repousse l'échéance. */
export const READY_TTL_S = 72 * 3600;
/** Un échec reste lisible une heure (le temps de l'expliquer), puis disparaît. */
export const FAILED_TTL_S = 3600;
const ID_RE = /^[0-9a-f]{32}$/;
/** Écriture de `touchedAt` au plus une fois par minute. */
const TOUCH_EVERY_MS = 60_000;

export type ClipState = "uploading" | "processing" | "ready" | "failed";

type Meta = {
  id: string;
  sessionId: string;
  ownerId: number;
  /** Nom à afficher (nettoyé) ; jamais utilisé comme chemin. */
  filename: string;
  extension: string;
  /** Démultiplexeur imposé à ffprobe et ffmpeg (déduit du contenu réel, une fois l'envoi reçu). */
  format: string | null;
  size: number;
  chunkSize: number;
  chunks: number;
  state: ClipState;
  createdAt: string;
  touchedAt: number;
  /** Empreinte de l'original : identité de la vidéo (clé de réutilisation d'un export identique). */
  sha256: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  /** Poids de la copie préparée. */
  bytes: number | null;
  failure: ClipCode | null;
};

/** Refus lisible : un code HTTP, la raison (`ClipCode`) et sa phrase en français clair. */
export class ClipError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClipCode,
    context: { size?: number; seconds?: number } = {},
  ) {
    super(clipExplanation(code, { limits: clipLimitsNow(), ...context }));
    this.name = "ClipError";
  }
}

export const clipLimitsNow = (): ClipLimits => parseClipLimits(process.env);

/** Outils extérieurs, injectables (les tests simulent ffprobe et ffmpeg). */
export type ClipDeps = {
  /** Type réel du fichier posé sur le disque (signature des premiers octets). */
  sniff: (file: string) => Promise<Sniff>;
  probe: (file: string, format: string) => Promise<ClipProbe>;
  normalize: typeof normalizeClip;
  freeBytes: (dir: string) => Promise<number | null>;
  now: () => number;
};

export const defaultClipDeps: ClipDeps = {
  sniff: sniffFile,
  probe: ffprobeClip,
  normalize: normalizeClip,
  freeBytes,
  now: () => Date.now(),
};

const root = () => path.join(reviewRoot(), "background-videos");
const dirOf = (id: string) => path.join(root(), id);
const metaFile = (id: string) => path.join(dirOf(id), "meta.json");
const originalOf = (meta: Meta) =>
  path.join(dirOf(meta.id), `original${meta.extension}`);
const copyOf = (id: string) => path.join(dirOf(id), "video.mp4");
const planOf = (meta: Meta): ChunkPlan => planChunks(meta.size, meta.chunkSize);
const unknown = () => new ClipError(404, "missing");

export type ClipContext = { id: string; sessionId: string; ownerId: number };
type Owner = Omit<ClipContext, "id">;

// ── mémoire du processus : préparation en cours, verrous ───────────────────────────────────────

type Running = {
  promise: Promise<void>;
  ratio: number;
  controller: AbortController;
};
type Registry = {
  queue: Promise<unknown>;
  running: Map<string, Running>;
  locks: Map<string, Promise<unknown>>;
};
const HOLDER = Symbol.for("aqr.background-videos");
function registry(): Registry {
  const holder = globalThis as { [HOLDER]?: Registry };
  return (holder[HOLDER] ??= {
    queue: Promise.resolve(),
    running: new Map(),
    locks: new Map(),
  });
}

/** Exécute `work` après tout ce qui tient déjà `key` (un seul à la fois par clé, dans l'ordre d'arrivée). */
function locked<T>(key: string, work: () => Promise<T>): Promise<T> {
  const { locks } = registry();
  const run = (locks.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(work);
  const tail = run.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}

// ── méta sur disque ────────────────────────────────────────────────────────────────────────────

async function readMetaRaw(id: string): Promise<Meta | null> {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(await readFile(metaFile(id), "utf8")) as Meta;
  } catch {
    return null;
  }
}

async function writeMeta(meta: Meta): Promise<void> {
  const target = metaFile(meta.id);
  const temp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(meta), { mode: 0o600 });
    await rename(temp, target); // atomique : on ne lit jamais une méta à moitié écrite
  } catch (error) {
    await rm(temp, { force: true });
    throw diskError(error);
  }
}

/** Relit puis réécrit la méta sous verrou ; `null` si la vidéo a disparu entre-temps. */
function updateMeta(
  id: string,
  change: (meta: Meta) => Meta,
): Promise<Meta | null> {
  return locked(`meta:${id}`, async () => {
    const meta = await readMetaRaw(id);
    if (!meta) return null;
    const next = change(meta);
    await writeMeta(next);
    return next;
  });
}

/** La vidéo de CE compte pour CETTE session ; sinon « inconnue » (jamais « interdit »). */
async function owned(ctx: ClipContext): Promise<Meta> {
  const meta = await readMetaRaw(ctx.id);
  if (!meta || meta.ownerId !== ctx.ownerId || meta.sessionId !== ctx.sessionId)
    throw unknown();
  return meta;
}

// ── vue publique ───────────────────────────────────────────────────────────────────────────────

export type PublicClip = {
  id: string;
  name: string;
  state: ClipState;
  size: number;
  /** Avancement de la préparation (0 à 1) tant qu'elle tourne, 1 une fois prête ; `null` sinon. */
  ratio: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  /** Poids de la copie préparée (octets). */
  bytes: number | null;
  failure: ClipCode | null;
  /** L'échec en français clair (cause, conséquence, que faire). */
  message: string | null;
};

function publicOf(meta: Meta): PublicClip {
  const running = registry().running.get(meta.id);
  return {
    id: meta.id,
    name: meta.filename,
    state: meta.state,
    size: meta.size,
    ratio:
      meta.state === "ready"
        ? 1
        : meta.state === "processing"
          ? (running?.ratio ?? 0)
          : null,
    duration: meta.duration,
    width: meta.width,
    height: meta.height,
    bytes: meta.bytes,
    failure: meta.failure,
    message: meta.failure
      ? clipExplanation(meta.failure, { limits: clipLimitsNow() })
      : null,
  };
}

// ── création ───────────────────────────────────────────────────────────────────────────────────

export type CreateClip = Owner & { filename: string; size: number };
export type CreatedClip = {
  id: string;
  chunk_size: number;
  chunks: number;
  size: number;
  limits: ClipLimits;
};

async function countOf(ownerId: number): Promise<number> {
  let count = 0;
  for (const id of await readdir(root()).catch(() => [] as string[])) {
    const meta = await readMetaRaw(id);
    // Un échec n'occupe plus de place (il disparaît seul) : il ne bloque pas un nouvel essai.
    if (meta && meta.ownerId === ownerId && meta.state !== "failed") count++;
  }
  return count;
}

export async function createClip(
  input: CreateClip,
  deps: ClipDeps = defaultClipDeps,
): Promise<CreatedClip> {
  if (!isSessionId(input.sessionId)) throw unknown();
  const limits = clipLimitsNow();
  let name: { name: string; extension: string };
  try {
    name = sanitizeName(input.filename, CLIP_EXTENSIONS, "format");
  } catch {
    throw new ClipError(400, "format");
  }
  const refusal = checkClipFile({ name: name.name, size: input.size }, limits);
  if (refusal)
    throw new ClipError(refusal.code === "too_big" ? 413 : 400, refusal.code, {
      size: input.size,
    });
  await cleanupExpiredClips(deps.now()).catch(() => 0);
  // Place disque : l'original ET sa copie préparée coexistent un moment ; refus propre avant d'écrire.
  if (wouldFillDisk(await deps.freeBytes(reviewRoot()), input.size * 2))
    throw new ClipError(507, "disk_full");
  // Vérification et création d'un seul tenant : deux demandes simultanées ne dépassent pas le plafond.
  return locked(`owner:${input.ownerId}`, async () => {
    if ((await countOf(input.ownerId)) >= limits.maxClips)
      throw new ClipError(409, "too_many");
    const id = randomBytes(16).toString("hex");
    const chunkSize = chunkBytes();
    const plan = planChunks(input.size, chunkSize);
    const meta: Meta = {
      id,
      sessionId: input.sessionId,
      ownerId: input.ownerId,
      filename: name.name,
      extension: name.extension,
      format: null,
      size: input.size,
      chunkSize,
      chunks: plan.chunks,
      state: "uploading",
      createdAt: new Date(deps.now()).toISOString(),
      touchedAt: deps.now(),
      sha256: null,
      duration: null,
      width: null,
      height: null,
      bytes: null,
      failure: null,
    };
    try {
      await mkdir(dirOf(id), { recursive: true, mode: 0o700 });
      await writeMeta(meta);
    } catch (error) {
      await rm(dirOf(id), { recursive: true, force: true });
      throw error instanceof ImportError
        ? new ClipError(error.status, "disk_full")
        : diskError(error);
    }
    return {
      id,
      chunk_size: chunkSize,
      chunks: plan.chunks,
      size: input.size,
      limits,
    };
  });
}

// ── morceaux, état, liste ──────────────────────────────────────────────────────────────────────

export async function receiveClipChunk(
  input: ClipContext & { index: number; body: Buffer },
): Promise<{ received: number; chunks: number }> {
  const meta = await owned(input);
  if (meta.state !== "uploading") throw new ClipError(409, "not_ready");
  const dir = dirOf(meta.id);
  await writeChunk(dir, planOf(meta), input.index, input.body);
  return {
    received: (await receivedIndexes(dir, planOf(meta))).length,
    chunks: meta.chunks,
  };
}

export type ClipStatus = PublicClip & {
  chunk_size: number;
  chunks: number;
  /** Morceaux déjà reçus (envoi en cours) : de quoi reprendre après une coupure. */
  received: number[];
};

export async function clipStatus(
  ctx: ClipContext,
  deps: ClipDeps = defaultClipDeps,
): Promise<ClipStatus> {
  const meta = await owned(ctx);
  // Redémarrage du serveur pendant la préparation : l'original est là, elle repart seule.
  if (meta.state === "processing") ensureRunning(meta.id, deps);
  await touchClip(ctx, deps.now());
  return {
    ...publicOf(meta),
    chunk_size: meta.chunkSize,
    chunks: meta.chunks,
    received:
      meta.state === "uploading"
        ? await receivedIndexes(dirOf(meta.id), planOf(meta))
        : [],
  };
}

export async function listClips(ctx: Owner): Promise<PublicClip[]> {
  const found: Meta[] = [];
  for (const id of await readdir(root()).catch(() => [] as string[])) {
    const meta = await readMetaRaw(id);
    if (
      meta &&
      meta.ownerId === ctx.ownerId &&
      meta.sessionId === ctx.sessionId
    )
      found.push(meta);
  }
  return found
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(publicOf);
}

/** Repousse l'expiration d'une vidéo : appelé à chaque usage. */
export async function touchClip(
  ctx: ClipContext,
  at: number = Date.now(),
): Promise<void> {
  const meta = await owned(ctx);
  if (at - meta.touchedAt < TOUCH_EVERY_MS && at >= meta.touchedAt) return;
  await updateMeta(ctx.id, (m) => ({
    ...m,
    touchedAt: Math.max(at, m.touchedAt),
  }));
}

// ── abandon ────────────────────────────────────────────────────────────────────────────────────

/** Supprime la vidéo (reçue ou prête) et arrête sa préparation si elle tourne. */
export async function abortClip(ctx: ClipContext): Promise<void> {
  const meta = await owned(ctx);
  await removeClip(meta.id);
}

async function removeClip(id: string): Promise<void> {
  registry().running.get(id)?.controller.abort();
  await rm(dirOf(id), { recursive: true, force: true });
}

// ── assemblage ─────────────────────────────────────────────────────────────────────────────────

/**
 * Assemble les morceaux, vérifie le TYPE RÉEL (signature, puis sonde avec démultiplexeur imposé), et lance la
 * préparation. Un refus définitif (type, image absente, abîmée, trop longue, empreinte) supprime tout ; un
 * incident passager (disque plein, sonde absente) garde l'envoi pour réessayer. Idempotent : redemander après
 * coup rend l'état.
 */
export async function completeClip(
  ctx: ClipContext,
  deps: ClipDeps = defaultClipDeps,
  options: { sha256?: string | null } = {},
): Promise<PublicClip> {
  const first = await owned(ctx);
  if (first.state !== "uploading") {
    if (first.state === "processing") ensureRunning(first.id, deps);
    return publicOf(first);
  }
  const dir = dirOf(first.id);
  const marker = path.join(dir, "completing");
  try {
    await (await open(marker, "wx")).close();
  } catch {
    throw new ClipError(409, "not_ready");
  }
  const release = () => rm(marker, { force: true });
  const refuse = async (error: ClipError) => {
    await removeClip(first.id);
    throw error;
  };
  try {
    const plan = planOf(first);
    const present = await receivedIndexes(dir, plan);
    if (present.length !== first.chunks)
      throw new ImportError(
        409,
        `Il manque des morceaux (${present.length} reçus sur ${first.chunks}).`,
      );
    // Assemblage sur disque, empreinte et taille contrôlées au vol.
    const original = originalOf(first);
    const hash = createHash("sha256");
    let written = 0;
    await pipeline(
      Readable.from(chunkStream(dir, plan)),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          written += chunk.length;
          hash.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(original, { mode: 0o600 }),
    );
    if (written !== first.size)
      return await refuse(new ClipError(400, "interrupted"));
    const digest = hash.digest("hex");
    if (options.sha256 && digest !== options.sha256.toLowerCase())
      return await refuse(new ClipError(400, "interrupted"));
    // Le contenu d'abord : ce qui n'est pas un conteneur vidéo n'atteint jamais ffprobe ni ffmpeg.
    const kind = await deps.sniff(original);
    const format = kind.ok ? inputFormatOf(kind.family) : null;
    if (!format) return await refuse(new ClipError(415, "format"));
    let probe: ClipProbe;
    try {
      probe = await deps.probe(original, format);
    } catch (error) {
      if (!(error instanceof ClipRejected)) throw error;
      if (error.code === "server") throw new ClipError(503, "server");
      return await refuse(new ClipError(422, error.code));
    }
    const limits = clipLimitsNow();
    if (probe.duration !== null && probe.duration > limits.maxSeconds)
      return await refuse(
        new ClipError(413, "too_long", { seconds: probe.duration }),
      );
    for (let i = 0; i < first.chunks; i++)
      await rm(path.join(dir, `chunk-${i}.part`), { force: true });
    const next = await updateMeta(first.id, (m) => ({
      ...m,
      state: "processing",
      format,
      sha256: digest,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      touchedAt: deps.now(),
    }));
    if (!next) throw unknown(); // supprimée pendant l'assemblage
    await release();
    ensureRunning(next.id, deps);
    return publicOf(next);
  } catch (error) {
    await release();
    if (error instanceof ClipError) throw error;
    if (error instanceof ImportError)
      throw error.status === 409
        ? error
        : new ClipError(
            error.status,
            error.status === 507 ? "disk_full" : "server",
          );
    if ((error as NodeJS.ErrnoException)?.code === "ENOSPC")
      throw new ClipError(507, "disk_full");
    log.error("video", "assemblage de la vidéo de fond en échec", error);
    throw new ClipError(500, "server");
  }
}

// ── préparation (une à la fois) ────────────────────────────────────────────────────────────────

function ensureRunning(id: string, deps: ClipDeps): void {
  const reg = registry();
  if (reg.running.has(id)) return;
  const entry: Running = {
    promise: Promise.resolve(),
    ratio: 0,
    controller: new AbortController(),
  };
  // Une seule préparation à la fois : le serveur est partagé et limité (2 cœurs), la file est l'ordre d'arrivée.
  entry.promise = reg.queue
    .catch(() => undefined)
    .then(() => prepare(id, deps, entry))
    .finally(() => {
      if (reg.running.get(id) === entry) reg.running.delete(id);
    });
  reg.queue = entry.promise;
  reg.running.set(id, entry);
}

/** Attend la fin de la préparation en cours de cette vidéo (tests, arrêt propre). */
export async function settledClip(id: string): Promise<void> {
  await registry().running.get(id)?.promise;
}

async function prepare(
  id: string,
  deps: ClipDeps,
  entry: Running,
): Promise<void> {
  const meta = await readMetaRaw(id);
  if (!meta || meta.state !== "processing" || !meta.format) return;
  const limits = clipLimitsNow();
  const temp = path.join(dirOf(id), "video.tmp.mp4");
  const { signal } = entry.controller;
  if (signal.aborted) return; // supprimée avant son tour dans la file
  try {
    await deps.normalize({
      source: originalOf(meta),
      output: temp,
      format: meta.format,
      maxSeconds: limits.maxSeconds,
      duration: meta.duration,
      onRatio: (ratio) => {
        entry.ratio = ratio;
      },
      signal,
    });
    // La copie fait foi (durée, taille affichée) : un WebM sans durée en reçoit une ici.
    const out = await deps.probe(temp, "mov");
    if (!(out.duration !== null && out.duration > 0))
      throw new ClipRejected("unreadable");
    if (out.duration > limits.maxSeconds + 0.5)
      throw new ClipRejected("too_long");
    await rename(temp, copyOf(id));
    const { size } = await stat(copyOf(id));
    await rm(originalOf(meta), { force: true });
    entry.ratio = 1;
    await updateMeta(id, (m) => ({
      ...m,
      state: "ready",
      duration: out.duration,
      width: out.width,
      height: out.height,
      bytes: size,
      failure: null,
      touchedAt: deps.now(),
    }));
  } catch (error) {
    if (signal.aborted) return; // supprimée ou arrêtée : plus rien à dire
    const code: ClipCode =
      error instanceof ClipRejected
        ? error.code
        : (error as NodeJS.ErrnoException)?.code === "ENOENT"
          ? "server"
          : "unreadable";
    log.warn(
      "video",
      `préparation de la vidéo de fond en échec (${code})`,
      error,
    );
    await rm(temp, { force: true });
    await rm(originalOf(meta), { force: true });
    await updateMeta(id, (m) => ({
      ...m,
      state: "failed",
      failure: code,
      touchedAt: deps.now(),
    }));
  }
}

// ── lecture par le rendu ───────────────────────────────────────────────────────────────────────

export type ReadyClip = {
  path: string;
  size: number;
  sha256: string;
  duration: number;
  name: string;
};

/** La copie préparée, pour le rendu ; refuse tant qu'elle n'est pas prête, et pour tout autre compte ou session. */
export async function readyClip(
  ctx: ClipContext,
  now: number = Date.now(),
): Promise<ReadyClip> {
  const meta = await owned(ctx);
  if (meta.state === "failed")
    throw new ClipError(422, meta.failure ?? "unreadable");
  if (meta.state !== "ready") throw new ClipError(409, "not_ready");
  const file = copyOf(meta.id);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    throw unknown();
  }
  await touchClip(ctx, now);
  return {
    path: file,
    size,
    sha256: meta.sha256 ?? meta.id,
    duration: meta.duration ?? 0,
    name: meta.filename,
  };
}

// ── nettoyage ──────────────────────────────────────────────────────────────────────────────────

/** Retire les vidéos d'une session (suppression de la session) ou d'un compte (suppression du compte). */
export async function purgeClips(filter: {
  sessionId?: string;
  ownerId?: number;
}): Promise<number> {
  if (filter.sessionId === undefined && filter.ownerId === undefined) return 0;
  let removed = 0;
  for (const id of await readdir(root()).catch(() => [] as string[])) {
    const meta = await readMetaRaw(id);
    if (!meta) continue;
    if (filter.sessionId !== undefined && meta.sessionId !== filter.sessionId)
      continue;
    if (filter.ownerId !== undefined && meta.ownerId !== filter.ownerId)
      continue;
    await removeClip(id);
    removed++;
  }
  return removed;
}

const ttlOf = (state: ClipState): number =>
  state === "ready"
    ? READY_TTL_S
    : state === "failed"
      ? FAILED_TTL_S
      : UPLOAD_TTL_S;

/** Retire les vidéos expirées ; rend leur nombre. Un dossier sans méta lisible part après 24 h. */
export async function cleanupExpiredClips(
  now: number = Date.now(),
): Promise<number> {
  let removed = 0;
  for (const id of await readdir(root()).catch(() => [] as string[])) {
    if (!ID_RE.test(id)) continue; // dossier étranger : laissé tel quel
    const meta = await readMetaRaw(id);
    try {
      if (meta) {
        if (now - meta.touchedAt <= ttlOf(meta.state) * 1000) continue;
      } else {
        const { mtimeMs } = await stat(dirOf(id));
        if (now - mtimeMs <= UPLOAD_TTL_S * 1000) continue;
      }
      await removeClip(id);
      removed++;
    } catch {
      /* déjà retiré */
    }
  }
  return removed;
}
