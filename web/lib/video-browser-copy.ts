import { execFile, spawn } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ffmpegCommand } from "./listening";
import { sessionDir } from "./store";

/**
 * Copie de travail de la vidéo d'origine, fabriquée UNE fois dans `listening/` et servie à la place de la source.
 * Deux raisons : le Chrome du serveur (Linux) ne décode pas le HEVC des téléphones, et surtout le rendu se
 * positionne dans la vidéo image par image : sur une source 4K à images clés espacées, c'est 0,9 image par
 * seconde (une vidéo de 2 min mettrait plus d'une heure). La copie est en 1080p au plus, H.264, avec une image
 * clé toutes les 8 images : mesuré 17 fois plus vite (≈ 16 images par seconde) pour un fichier modéré.
 */
export const BROWSER_VIDEO_CODECS = new Set(["h264", "vp8", "vp9", "av1"]);
const COPY_NAME = "video-browser-v2.mp4";
/** Ancienne copie (pleine taille, images clés rares) : ignorée, supprimée quand la nouvelle se fabrique. */
const LEGACY_COPY_NAME = "video-browser.mp4";
/** Côté le plus long de la copie (px) et intervalle d'images clés. */
export const COPY_LONG_SIDE = 1920;
export const COPY_KEYFRAME_EVERY = 8;
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
export type VideoInfo = {
  codec: string;
  width: number;
  height: number;
  /** Durée du fichier (s), si ffprobe la donne : sert au pourcentage de préparation. */
  duration?: number;
};

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
  let seconds = Number.NaN;
  try {
    const parsed = JSON.parse(stdout) as {
      streams?: ProbedStream[];
      format?: { duration?: string };
    };
    streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    seconds = Number(parsed.format?.duration);
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
  const duration = seconds > 0 ? { duration: seconds } : {};
  return turned
    ? { codec: stream.codec_name, width: height, height: width, ...duration }
    : { codec: stream.codec_name, width, height, ...duration };
}

/** `VideoInfo`, `NO_VIDEO` si la source n'a pas d'image, `null` si ffprobe échoue. */
export async function probeVideo(
  source: string,
): Promise<VideoInfo | typeof NO_VIDEO | null> {
  const ffprobe = ffmpegCommand().replace(/ffmpeg(.exe)?$/, "ffprobe$1");
  try {
    const { stdout } = await exec(ffprobe, [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height:stream_tags=rotate:stream_side_data=rotation:format=duration",
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

/** Vrai si la source a une image à copier (tout sauf un son seul). */
export function needsRenderCopy(codec: string | null): boolean {
  return codec !== NO_VIDEO;
}

/** Arguments ffmpeg de la copie : 1080p au plus (jamais agrandie), H.264, image clé toutes les 8 images, sans son. */
export function copyArgs(source: string, output: string): string[] {
  const side = COPY_LONG_SIDE;
  const scale = `scale='if(gt(iw,ih),min(${side},iw),-2)':'if(gt(iw,ih),-2,min(${side},ih))'`;
  return [
    "-nostdin", "-v", "error", "-nostats", "-y", "-i", source, "-an",
    "-vf", scale,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-g", String(COPY_KEYFRAME_EVERY), "-keyint_min", String(COPY_KEYFRAME_EVERY),
    // Mémoire et processeur bornés : le serveur est partagé et limité à 2 cœurs.
    "-threads", "2",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    "-progress", "pipe:1", output,
  ]; // prettier-ignore
}

/** Part faite (0..1) d'après une ligne `out_time_us=…` du suivi de ffmpeg ; `null` pour les autres lignes. */
export function progressRatio(line: string, duration: number): number | null {
  const match = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  if (!match || !(duration > 0)) return null;
  return Math.min(1, Math.max(0, Number(match[1]) / 1e6 / duration));
}

type Ratio = (ratio: number) => void;
const listeners = new Map<string, Set<Ratio>>();

async function transcode(
  source: string,
  output: string,
  duration: number,
  onRatio: Ratio,
): Promise<void> {
  const tmp = `${output}.tmp.mp4`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegCommand(), copyArgs(source, tmp), {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let rest = "";
    let errors = "";
    child.stdout.on("data", (chunk: Buffer) => {
      const lines = (rest + chunk.toString()).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const line of lines) {
        const ratio = progressRatio(line, duration);
        if (ratio !== null) onRatio(ratio);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-2000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), 30 * 60_000);
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(new Error(`ffmpeg a échoué (code ${code}) : ${errors.trim()}`));
    });
  });
  await rename(tmp, output);
}

const outputOf = (sessionId: string, name = COPY_NAME) =>
  path.join(sessionDir(sessionId), "listening", name);

/** Copie fabriquée et à jour pour cette source, ou `null` (source sans image, ou pas encore prête). */
async function freshCopy(
  sessionId: string,
  source: string,
): Promise<string | null> {
  if (!needsRenderCopy(await codecOf(source))) return null;
  const output = outputOf(sessionId);
  const sourceTime = (await stat(source)).mtimeMs;
  const current = await stat(output).catch(() => null);
  return current && current.mtimeMs >= sourceTime ? output : null;
}

// Une seule fabrication à la fois : plusieurs sources 4K en parallèle saturaient la mémoire (2 Go) du serveur.
let queue: Promise<unknown> = Promise.resolve();

/**
 * Lancer la fabrication de la copie sans attendre (la route vidéo ne doit jamais bloquer la page).
 * Sans effet si la fabrication de cette copie est déjà en cours ; sinon elle passe dans la file.
 * `onRatio` suit l'avancement (0..1) tant que la copie se fabrique.
 */
function startCopy(
  sessionId: string,
  source: string,
  onRatio?: Ratio,
): Promise<string> {
  const output = outputOf(sessionId);
  if (onRatio) {
    const set = listeners.get(output) ?? new Set<Ratio>();
    set.add(onRatio);
    listeners.set(output, set);
  }
  let job = pending.get(output);
  if (!job) {
    job = queue
      .catch(() => undefined)
      .then(async () => {
        await mkdir(path.dirname(output), { recursive: true });
        await rm(output, { force: true });
        await rm(outputOf(sessionId, LEGACY_COPY_NAME), { force: true });
        const info = await videoInfoOf(source);
        const duration =
          info && info !== NO_VIDEO && info.duration ? info.duration : 0;
        await transcode(source, output, duration, (ratio) => {
          for (const listener of listeners.get(output) ?? []) listener(ratio);
        });
        return output;
      })
      .finally(() => {
        pending.delete(output);
        listeners.delete(output);
      });
    queue = job;
    pending.set(output, job);
  }
  return job;
}

/**
 * Fichier à servir maintenant : la copie si elle est prête ; sinon la source quand ce navigateur sait la lire
 * (la copie se fabrique alors en arrière-plan) ; sinon `null` (« en préparation »).
 */
export async function readyBrowserFile(
  sessionId: string,
  source: string,
): Promise<{ path: string; copied: boolean } | null> {
  const codec = await codecOf(source);
  if (!needsRenderCopy(codec)) return { path: source, copied: false };
  const copy = await freshCopy(sessionId, source);
  if (copy) return { path: copy, copied: true };
  startCopy(sessionId, source).catch(() => undefined);
  return needsBrowserCopy(codec) ? null : { path: source, copied: false };
}

/**
 * Pour un export : attend la copie (le rendu a besoin d'une image qu'il sait positionner vite).
 * Sans effet pour un son seul. `onRatio` suit la fabrication.
 */
export async function prepareBrowserFile(
  sessionId: string,
  source: string,
  onRatio?: Ratio,
): Promise<string | null> {
  const codec = await codecOf(source);
  if (!needsRenderCopy(codec)) return null;
  const copy = await freshCopy(sessionId, source);
  return copy ?? startCopy(sessionId, source, onRatio);
}
