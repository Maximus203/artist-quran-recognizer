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
const exec = promisify(execFile);
const pending = new Map<string, Promise<string>>();

/** Vrai si le navigateur du serveur doit recevoir une copie (codec absent ou illisible). */
export function needsBrowserCopy(codec: string | null): boolean {
  return codec === null || !BROWSER_VIDEO_CODECS.has(codec.toLowerCase());
}

export async function probeVideoCodec(source: string): Promise<string | null> {
  const ffprobe = ffmpegCommand().replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
  try {
    const { stdout } = await exec(ffprobe, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name", "-of", "csv=p=0", source,
    ], { windowsHide: true, timeout: 60_000 }); // prettier-ignore
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

// Le codec ne change qu'avec le fichier : on ne relance pas ffprobe à chaque requête de lecture.
const codecs = new Map<string, { mtimeMs: number; codec: string | null }>();
async function codecOf(source: string): Promise<string | null> {
  const mtimeMs = (await stat(source)).mtimeMs;
  const known = codecs.get(source);
  if (known && known.mtimeMs === mtimeMs) return known.codec;
  const codec = await probeVideoCodec(source);
  codecs.set(source, { mtimeMs, codec });
  return codec;
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

/**
 * Fichier vidéo à servir au navigateur de rendu : la source si elle est lisible, sinon la copie H.264
 * (fabriquée au premier besoin, puis réutilisée tant que la source n'a pas changé).
 */
export async function browserVideoFile(
  sessionId: string,
  source: string,
): Promise<{ path: string; copied: boolean }> {
  const codec = await codecOf(source);
  if (!needsBrowserCopy(codec)) return { path: source, copied: false };
  const dir = path.join(sessionDir(sessionId), "listening");
  const output = path.join(dir, COPY_NAME);
  const sourceTime = (await stat(source)).mtimeMs;
  const current = await stat(output).catch(() => null);
  if (current && current.mtimeMs >= sourceTime)
    return { path: output, copied: true };
  let job = pending.get(output);
  if (!job) {
    job = (async () => {
      await mkdir(dir, { recursive: true });
      await rm(output, { force: true });
      await transcode(source, output);
      return output;
    })().finally(() => pending.delete(output));
    pending.set(output, job);
  }
  return { path: await job, copied: true };
}
