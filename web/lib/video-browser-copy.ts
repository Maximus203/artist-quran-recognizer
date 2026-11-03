import { execFile } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ffmpegCommand } from "./listening";
import { sessionDir } from "./store";

/**
 * Vidéo d'origine lisible par le navigateur de rendu. Le Chrome du serveur (Linux) ne décode pas le HEVC
 * des téléphones : le fond de l'export restait vide. Dans ce cas on fabrique UNE copie H.264, une fois,
 * dans `listening/`, et on la sert à la place. Les formats déjà lisibles ne sont pas touchés.
 */
export const BROWSER_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const COPY_NAME = "video-browser.mp4";
/** Source sans flux vidéo (enregistrement audio seul, ex. micro en .webm) : il n'y a rien à copier. */
export const NO_VIDEO = "aucun";
const exec = promisify(execFile);
const pending = new Map<string, Promise<string>>();

/** Vrai si le navigateur du serveur doit recevoir une copie (codec absent ou illisible). */
export function needsBrowserCopy(codec: string | null): boolean {
  if (codec === NO_VIDEO) return false;
  return codec === null || !BROWSER_VIDEO_CODECS.has(codec.toLowerCase());
}

/** Premier flux vidéo d'une source : codec et taille AFFICHÉE (la rotation des téléphones est appliquée). */
export type VideoInfo = { codec: string; width: number; height: number };

type ProbedStream = {
  codec_name?: string;
  width?: number;
  height?: number;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
};

/**
 * Lit la sortie JSON de ffprobe : `NO_VIDEO` sans flux vidéo (son seul), `null` si la sortie est illisible.
 * Un téléphone tenu à la verticale code 1920×1080 avec une rotation de 90° : la taille affichée est 1080×1920.
 */
export function parseVideoInfo(
  stdout: string,
): VideoInfo | typeof NO_VIDEO | null {
  let streams: ProbedStream[];
  try {
    const parsed = JSON.parse(stdout) as { streams?: ProbedStream[] };
    streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  } catch {
    return null;
  }
  const stream = streams[0];
  if (!stream?.codec_name) return NO_VIDEO;
  const width = Number(stream.width);
  const height = Number(stream.height);
  if (!(width > 0) || !(height > 0)) return NO_VIDEO;
  const raw =
    stream.side_data_list?.find((d) => typeof d.rotation === "number")
      ?.rotation ?? Number(stream.tags?.rotate ?? 0);
  const turned = Math.abs(Number.isFinite(raw) ? raw : 0) % 180 === 90;
  return turned
    ? { codec: stream.codec_name, width: height, height: width }
    : { codec: stream.codec_name, width, height };
}

/** `VideoInfo`, `NO_VIDEO` si la source n'a pas d'image, `null` si ffprobe échoue. */
export async function probeVideo(
  source: string,
): Promise<VideoInfo | typeof NO_VIDEO | null> {
  const ffprobe = ffmpegCommand().replace(/ffmpeg(.exe)?$/, "ffprobe$1");
  try {
    const { stdout } = await exec(ffprobe, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height:stream_tags=rotate:stream_side_data=rotation",
      "-of", "json", source,
    ], { windowsHide: true, timeout: 60_000 }); // prettier-ignore
    return parseVideoInfo(stdout);
  } catch {
    return null;
  }
}

/** Codec du premier flux vidéo, `NO_VIDEO` si la source n'en a pas, `null` si ffprobe échoue. */
export async function probeVideoCodec(source: string): Promise<string | null> {
  const info = await probeVideo(source);
  return info === null ? null : info === NO_VIDEO ? NO_VIDEO : info.codec;
}

// Le contenu ne change qu'avec le fichier : on ne relance pas ffprobe à chaque requête.
const infos = new Map<
  string,
  { mtimeMs: number; info: VideoInfo | typeof NO_VIDEO | null }
>();
export async function videoInfoOf(
  source: string,
): Promise<VideoInfo | typeof NO_VIDEO | null> {
  const mtimeMs = (await stat(source)).mtimeMs;
  const known = infos.get(source);
  if (known && known.mtimeMs === mtimeMs) return known.info;
  const info = await probeVideo(source);
  // Un échec de ffprobe n'est pas mémorisé : la prochaine demande réessaie.
  if (info !== null) infos.set(source, { mtimeMs, info });
  return info;
}

async function codecOf(source: string): Promise<string | null> {
  const info = await videoInfoOf(source);
  return info === null ? null : info === NO_VIDEO ? NO_VIDEO : info.codec;
}

async function transcode(source: string, output: string): Promise<void> {
  const tmp = `${output}.tmp.mp4`;
  await exec(ffmpegCommand(), [
    "-nostdin", "-v", "error", "-y", "-i", source, "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", tmp,
  ], { windowsHide: true, timeout: 30 * 60_000 }); // prettier-ignore
  await rename(tmp, output);
}

/** Copie fabriquée et à jour pour cette source, ou `null` (rien à faire : la source est lisible, ou pas encore prête). */
async function freshCopy(
  sessionId: string,
  source: string,
): Promise<string | null> {
  const codec = await codecOf(source);
  if (!needsBrowserCopy(codec)) return null;
  const output = path.join(sessionDir(sessionId), "listening", COPY_NAME);
  const sourceTime = (await stat(source)).mtimeMs;
  const current = await stat(output).catch(() => null);
  return current && current.mtimeMs >= sourceTime ? output : null;
}

/**
 * Lancer la fabrication de la copie sans attendre (la route vidéo ne doit jamais bloquer la page).
 * Sans effet si la copie est déjà prête ou si la fabrication est en cours.
 */
function startCopy(sessionId: string, source: string): Promise<string> {
  const output = path.join(sessionDir(sessionId), "listening", COPY_NAME);
  let job = pending.get(output);
  if (!job) {
    const dir = path.dirname(output);
    job = (async () => {
      await mkdir(dir, { recursive: true });
      await rm(output, { force: true });
      await transcode(source, output);
      return output;
    })().finally(() => pending.delete(output));
    pending.set(output, job);
  }
  return job;
}

/**
 * Fichier à servir maintenant : la source si elle est lisible, la copie si elle est prête, sinon `null`
 * (la fabrication part en arrière-plan ; l'appelant répond « en préparation »).
 */
export async function readyBrowserFile(
  sessionId: string,
  source: string,
): Promise<{ path: string; copied: boolean } | null> {
  const codec = await codecOf(source);
  if (!needsBrowserCopy(codec)) return { path: source, copied: false };
  const copy = await freshCopy(sessionId, source);
  if (copy) return { path: copy, copied: true };
  startCopy(sessionId, source).catch(() => undefined);
  return null;
}

/**
 * Pour un export : attend la copie si la source n'est pas lisible (le rendu a besoin de l'image).
 * Sans effet pour une source lisible.
 */
export async function prepareBrowserFile(
  sessionId: string,
  source: string,
): Promise<string | null> {
  const codec = await codecOf(source);
  if (!needsBrowserCopy(codec)) return null;
  return freshCopy(sessionId, source).then(
    (copy) => copy ?? startCopy(sessionId, source),
  );
}
