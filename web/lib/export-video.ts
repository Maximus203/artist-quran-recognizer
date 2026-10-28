/**
 * Moteur d'export vidéo côté serveur : mux des segments H.264 (rendus par le navigateur)
 * avec la copie d'écoute (temps 0 = temps du moteur) → MP4. Un export est un acte :
 * jamais mémorisé, les fichiers temporaires sont supprimés dans tous les cas.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { promisify } from "node:util";
import { NotReadyError } from "./export-engine";
import { muxArgs } from "./export-video-args";
import { ensureListening, ffmpegCommand } from "./listening";
import { audioPath, readSession, sessionDir } from "./store";

const exec = promisify(execFile);

/** Délai maximal du mux (concat + encodage AAC : rapide). */
export const VIDEO_TIMEOUT_MS = 10 * 60 * 1000;
/** Taille maximale d'un segment H.264 POSTé (256 Mio). */
export const MAX_SEGMENT_BYTES = 256 * 1024 * 1024;
/** Segments attendus : au moins 1, au plus (2 h à 12 Mbit/s ≈ 180) + marge. */
export const MAX_SEGMENTS = 512;

const JOB = /^[a-zA-Z0-9-]{8,64}$/;

export class InvalidJobError extends Error {
  constructor() {
    super("Identifiant de job vidéo invalide.");
    this.name = "InvalidJobError";
  }
}

export class InvalidMuxOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMuxOptionsError";
  }
}

/** Cadence des clients qui n'envoient pas `x-aqr-fps` (avant le choix 30/60). */
export const LEGACY_MUX_FPS = 25;

/** Cadences que le mux accepte (25 : anciens clients). */
export const MUX_FPS = [25, 30, 60] as const;

/** Réglages du mux envoyés avec le dernier segment : cadence et extrait de l'audio à garder. */
export type MuxOptions = {
  fps?: number;
  start?: number;
  duration?: number;
};

export function validMuxOptions(options: MuxOptions): MuxOptions {
  const { fps, start, duration } = options;
  if (fps !== undefined && !(MUX_FPS as readonly number[]).includes(fps))
    throw new InvalidMuxOptionsError(
      `Cadence refusée (${fps}) : 30 ou 60 images par seconde.`,
    );
  if ((start === undefined) !== (duration === undefined))
    throw new InvalidMuxOptionsError(
      "Plage incomplète : début et durée vont ensemble.",
    );
  if (start !== undefined && duration !== undefined) {
    if (!(start >= 0 && Number.isFinite(start)))
      throw new InvalidMuxOptionsError("Début de plage invalide.");
    if (!(duration > 0 && duration <= 24 * 3600))
      throw new InvalidMuxOptionsError("Durée de plage invalide.");
  }
  return options;
}

export type VideoExportFile = {
  name: string;
  mime: string;
  content: Buffer;
};

const lastLine = (text: string): string =>
  text.trim().split("\n").at(-1)?.trim() ?? "";

function sanitizeJob(job: string): string {
  if (!JOB.test(job)) throw new InvalidJobError();
  return job;
}

export function jobDir(id: string, job: string): string {
  return path.join(sessionDir(id), "exports", `video-${sanitizeJob(job)}`);
}

/** Écrit un segment H.264 dans le dossier du job (numérotation séquentielle stricte). */
export async function writeFrameSegment(
  id: string,
  job: string,
  index: number,
  data: Buffer,
): Promise<string> {
  if (!(index >= 0) || !Number.isInteger(index) || index >= MAX_SEGMENTS)
    throw new Error(`Segment invalide (${index}).`);
  if (data.length === 0) throw new Error("Segment vide.");
  if (data.length > MAX_SEGMENT_BYTES)
    throw new Error("Segment trop volumineux (256 Mio au plus).");
  const dir = jobDir(id, job);
  await mkdir(dir, { recursive: true });
  // Segments contigus uniquement : jamais de trou dans la numérotation.
  const previous =
    index === 0 ? null : path.join(dir, `part-${index - 1}.h264`);
  if (previous && (await stat(previous).catch(() => null)) === null)
    throw new Error(`Segment ${index} reçu avant le segment ${index - 1}.`);
  const file = path.join(dir, `part-${index}.h264`);
  await writeFile(file, data);
  return file;
}

/**
 * Mux final : concatène les segments du job avec la copie d'écoute et renvoie le MP4.
 * Nettoie le dossier du job dans tous les cas.
 */
export async function muxVideoFrames(
  id: string,
  job: string,
  run: typeof exec = exec,
  mux: MuxOptions = {},
): Promise<VideoExportFile> {
  validMuxOptions(mux);
  const session = await readSession(id);
  if (session.state !== "done") throw new NotReadyError();
  const dir = jobDir(id, job);
  // Liste des segments présents, triés par numéro.
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) =>
    /^part-\d+\.h264$/.test(f),
  );
  if (files.length === 0) throw new Error("Aucun segment vidéo reçu.");
  files.sort((a, b) => Number(a.slice(5, -5)) - Number(b.slice(5, -5)));
  const indices = files.map((f) => Number(f.slice(5, -5)));
  indices.forEach((n, i) => {
    if (n !== i)
      throw new Error(`Segments non contigus (manque le segment ${i}).`);
  });

  const listening = await ensureListening(sessionDir(id), await audioPath(id));
  const video = path.join(dir, "video.h264");
  const out = path.join(dir, "video.mp4");
  try {
    // Les segments (Annex B) se mettent simplement bout à bout, dans l'ordre.
    const sink = createWriteStream(video);
    for (const file of files) {
      await pipeline(createReadStream(path.join(dir, file)), sink, {
        end: false,
      });
    }
    await new Promise<void>((resolve, reject) => {
      sink.on("error", reject);
      sink.end(resolve);
    });
    try {
      await run(
        ffmpegCommand(),
        muxArgs({
          video,
          wav: listening.wav,
          out,
          fps: mux.fps ?? LEGACY_MUX_FPS,
          audioStart: mux.start,
          audioDuration: mux.duration,
        }),
        {
          windowsHide: true,
          timeout: VIDEO_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        },
      );
    } catch (e) {
      const err = e as NodeJS.ErrnoException & { stderr?: string };
      if (err.code === "ENOENT")
        throw new Error(
          `ffmpeg introuvable (${ffmpegCommand()}) : l'installer ou renseigner AQR_FFMPEG`,
        );
      throw new Error(
        `ffmpeg n'a pas pu assembler la vidéo (${lastLine(err.stderr || err.message)})`,
      );
    }
    const content = await readFile(out);
    return {
      name: `aqr-video-${session.name.replace(/[^\w.-]+/g, "_") || id}.mp4`,
      mime: "video/mp4",
      content,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Job frais pour un export (le navigateur le génère et le porte sur chaque segment). */
export function newVideoJob(): string {
  return randomUUID();
}
