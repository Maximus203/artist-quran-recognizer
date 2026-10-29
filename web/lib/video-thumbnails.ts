/**
 * Imagettes d'une session vidéo pour la frise d'export : une planche JPEG horizontale de `count`
 * images régulièrement réparties (la i-ème montre l'instant (i + 0,5) × durée / count), produite
 * par ffmpeg et gardée dans les fichiers dérivés (`listening/`, jamais exportés, régénérables).
 * Les seuls paramètres variables sont deux entiers bornés : rien de l'appelant n'atteint la commande.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { EXPORT_VIDEO_CONFIG } from "./export-video-config";
import { ffmpegCommand, LISTENING } from "./listening";

const T = EXPORT_VIDEO_CONFIG.thumbnails;
/** Au-delà de cette durée, on ne décode que les images clés (une planche en quelques secondes). */
const KEYFRAMES_ONLY_AFTER_S = 600;

export type ThumbnailQuery =
  | { ok: true; count: number; width: number }
  | { ok: false; error: string };

function integer(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number | string {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max)
    return `${name} : un entier entre ${min} et ${max} est attendu.`;
  return value;
}

export function parseThumbnailQuery(query: URLSearchParams): ThumbnailQuery {
  const count = integer(
    query.get("count"),
    T.defaultCount,
    1,
    T.maxCount,
    "count",
  );
  if (typeof count === "string") return { ok: false, error: count };
  const width = integer(
    query.get("width"),
    T.defaultWidth,
    T.minWidth,
    T.maxWidth,
    "width",
  );
  if (typeof width === "string") return { ok: false, error: width };
  return { ok: true, count, width };
}

export type ThumbnailOptions = {
  count: number;
  width: number;
  duration: number;
};

export function thumbnailArgs(
  source: string,
  output: string,
  { count, width, duration }: ThumbnailOptions,
): string[] {
  const rate = (count / Math.max(0.1, duration)).toFixed(6);
  const fast = duration > KEYFRAMES_ONLY_AFTER_S;
  return [
    "-nostdin", "-v", "error", "-y",
    ...(fast ? ["-skip_frame", "nokey"] : []),
    "-i", source, "-an",
    "-vf", `fps=${rate},scale=${width}:-2,tile=${count}x1`,
    "-frames:v", "1", "-q:v", "5", output,
  ]; // prettier-ignore
}

export const thumbnailFile = (
  sessionDirectory: string,
  count: number,
  width: number,
): string =>
  path.join(sessionDirectory, LISTENING.dir, `thumbs-${count}x${width}.jpg`);

export type FfmpegRun = (args: string[]) => Promise<void>;

const exec = promisify(execFile);
export const ffmpegRun: FfmpegRun = async (args) => {
  try {
    await exec(ffmpegCommand(), args, {
      windowsHide: true,
      timeout: T.timeoutMs,
      maxBuffer: 1024 * 1024,
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT")
      throw new Error(
        `ffmpeg introuvable (${ffmpegCommand()}) : l'installer ou renseigner AQR_FFMPEG`,
      );
    throw new Error(
      `ffmpeg n'a pas pu lire la vidéo (${(err.stderr || err.message).trim().split(/\r?\n/).at(-1)})`,
    );
  }
};

/** Chemin de la planche, produite si elle manque ou si la source est plus récente. */
export async function ensureThumbnails(
  sessionDirectory: string,
  source: string,
  options: ThumbnailOptions,
  run: FfmpegRun = ffmpegRun,
): Promise<string> {
  const target = thumbnailFile(sessionDirectory, options.count, options.width);
  try {
    const [made, origin] = await Promise.all([stat(target), stat(source)]);
    if (made.mtimeMs >= origin.mtimeMs && made.size > 0) return target;
  } catch {
    /* à produire */
  }
  await mkdir(path.dirname(target), { recursive: true });
  // Écrit à côté puis renommé : une requête concurrente ne lit jamais une planche à moitié écrite.
  const temp = `${target}.${randomUUID()}.jpg`;
  try {
    await run(thumbnailArgs(source, temp, options));
    await rename(temp, target);
  } finally {
    await rm(temp, { force: true });
  }
  return target;
}
