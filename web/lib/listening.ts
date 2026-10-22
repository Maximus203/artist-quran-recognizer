/**
 * Copie d'écoute d'une session : l'audio tel que le moteur l'a entendu.
 *
 * Pourquoi : un MP3 à débit variable (cas des fichiers extraits de vidéos) se positionne mal
 * dans le navigateur — mesuré sur un fichier de 45 min, un saut à 42:22.5 jouait l'audio de
 * 42:30.4 (+7,9 s), un saut à 20:00 celui de 19:49.7 (−10,3 s). Les temps du JSON, eux, sont
 * comptés sur le PCM décodé par ffmpeg (`aqr.adapters.ffmpeg_extractor`). La copie d'écoute est
 * ce même décodage (même ffmpeg, mono, même fréquence), écrit en WAV PCM : un WAV se
 * positionne à l'échantillon près, et son temps 0 est celui du moteur.
 *
 * Fichiers dérivés, régénérables, rangés à part (`listening/`) : jamais exportés dans le pack,
 * jamais comptés comme activité de revue.
 */
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const LISTENING = {
  /** Fréquence du moteur (`ExtractorConfig.sample_rate`). */
  sampleRate: 16000,
  /** Résolution des crêtes de la forme d'onde : une crête toutes les 20 ms. */
  peaksPerSecond: 50,
  /** Dossier exclu du calcul d'activité (`DERIVED_DIRS` de `store.ts`). */
  dir: "listening",
  wav: "listen.wav",
  peaks: "peaks.json",
  /** Délai maximal de transcodage (un fichier de plus de 2 h prend quelques secondes). */
  timeoutMs: 10 * 60 * 1000,
} as const;

export type Transcoder = (source: string, output: string) => Promise<void>;
export type ListeningFiles = { wav: string; peaks: string };
export type ListeningPeaks = {
  schema: "aqr.listening-peaks/1";
  sample_rate: number;
  per_second: number;
  duration: number;
  peaks: number[];
};

/** Exécutable ffmpeg : `AQR_FFMPEG`, sinon celui du PATH (comme le moteur). */
export function ffmpegCommand(): string {
  return process.env.AQR_FFMPEG || "ffmpeg";
}

/** Arguments ffmpeg : même chaîne que `FfmpegAudioExtractor` (-ac 1 -ar 16000), en WAV. */
export function listeningArgs(source: string, output: string): string[] {
  return [
    "-nostdin", "-v", "error", "-y", "-i", source, "-vn",
    "-ac", "1", "-ar", String(LISTENING.sampleRate),
    "-c:a", "pcm_s16le", "-f", "wav", output,
  ]; // prettier-ignore
}

const exec = promisify(execFile);
export const ffmpegTranscoder: Transcoder = async (source, output) => {
  try {
    await exec(ffmpegCommand(), listeningArgs(source, output), {
      windowsHide: true,
      timeout: LISTENING.timeoutMs,
      maxBuffer: 1024 * 1024,
    });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT")
      throw new Error(
        `ffmpeg introuvable (${ffmpegCommand()}) : l'installer ou renseigner AQR_FFMPEG`,
      );
    throw new Error(
      `ffmpeg n'a pas pu décoder l'audio (${(err.stderr || err.message).trim().split(/\r?\n/).at(-1)})`,
    );
  }
};

export type WavInfo = {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataOffset: number;
  dataLength: number;
  duration: number;
};

/** En-tête d'un WAV PCM 16 bits : parcourt les blocs (ffmpeg ajoute LIST avant `data`). */
export function parseWav(buffer: Buffer): WavInfo {
  if (
    buffer.length < 12 ||
    buffer.toString("latin1", 0, 4) !== "RIFF" ||
    buffer.toString("latin1", 8, 12) !== "WAVE"
  )
    throw new Error("Copie d'écoute illisible : ce n'est pas un WAV");
  let offset = 12,
    fmt: Omit<WavInfo, "dataOffset" | "dataLength" | "duration"> | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("latin1", offset, offset + 4),
      size = buffer.readUInt32LE(offset + 4),
      body = offset + 8;
    if (id === "fmt ")
      fmt = {
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    if (id === "data") {
      if (!fmt || fmt.bitsPerSample !== 16)
        throw new Error("Copie d'écoute illisible : WAV PCM 16 bits attendu");
      const dataLength = Math.min(size, buffer.length - body);
      return {
        ...fmt,
        dataOffset: body,
        dataLength,
        duration: dataLength / (2 * fmt.channels) / fmt.sampleRate,
      };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("Copie d'écoute illisible : WAV sans données");
}

/** Maximum absolu par tranche de `sampleRate / perSecond` échantillons, dans [0, 1]. */
export function computePeaks(
  samples: Int16Array,
  sampleRate: number,
  perSecond: number,
): number[] {
  const bucket = Math.max(1, Math.round(sampleRate / perSecond));
  const peaks: number[] = [];
  for (let start = 0; start < samples.length; start += bucket) {
    let max = 0;
    const end = Math.min(samples.length, start + bucket);
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > max) max = v;
    }
    peaks.push(Number(Math.min(1, max / 32767).toFixed(3)));
  }
  return peaks;
}

const MEDIA_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg",
  ".oga": "audio/ogg",
  ".flac": "audio/flac",
  ".webm": "audio/webm",
  // Conteneurs vidéo : le lecteur n'en joue que la piste sonore (repli quand ffmpeg échoue).
  ".mkv": "video/x-matroska",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".m4v": "video/x-m4v",
};
/** Type MIME du fichier original (repli quand la copie d'écoute est impossible). */
export function mediaType(extension: string): string {
  return MEDIA_TYPES[extension.toLowerCase()] || "application/octet-stream";
}

async function fresh(file: string, sourceMtimeMs: number): Promise<boolean> {
  try {
    return (await stat(file)).mtimeMs >= sourceMtimeMs;
  } catch {
    return false;
  }
}

async function build(
  sessionDir: string,
  source: string,
  transcode: Transcoder,
): Promise<ListeningFiles> {
  const dir = path.join(sessionDir, LISTENING.dir);
  const files = {
    wav: path.join(dir, LISTENING.wav),
    peaks: path.join(dir, LISTENING.peaks),
  };
  const sourceMtime = (await stat(source)).mtimeMs;
  if (
    (await fresh(files.wav, sourceMtime)) &&
    (await fresh(files.peaks, sourceMtime))
  )
    return files;
  await mkdir(dir, { recursive: true });
  const temp = path.join(dir, `${randomUUID()}.wav.tmp`);
  try {
    await transcode(source, temp);
    const buffer = await readFile(temp);
    const info = parseWav(buffer);
    const start = buffer.byteOffset + info.dataOffset,
      count = Math.floor(info.dataLength / 2);
    // Vue directe si alignée (cas de ffmpeg) : pas de copie de centaines de Mo.
    const samples =
      start % 2 === 0
        ? new Int16Array(buffer.buffer, start, count)
        : new Int16Array(buffer.buffer.slice(start, start + count * 2));
    const value: ListeningPeaks = {
      schema: "aqr.listening-peaks/1",
      sample_rate: info.sampleRate,
      per_second: LISTENING.peaksPerSecond,
      duration: Number(info.duration.toFixed(6)),
      peaks: computePeaks(samples, info.sampleRate, LISTENING.peaksPerSecond),
    };
    const peaksTemp = `${temp}.json`;
    await writeFile(peaksTemp, JSON.stringify(value), "utf8");
    await rename(temp, files.wav);
    await rename(peaksTemp, files.peaks);
    return files;
  } finally {
    await rm(temp, { force: true });
    await rm(`${temp}.json`, { force: true });
  }
}

const pending = new Map<string, Promise<ListeningFiles>>();

/** Copie d'écoute et crêtes à jour (créées au premier appel ; appels simultanés partagés). */
export function ensureListening(
  sessionDir: string,
  source: string,
  transcode: Transcoder = ffmpegTranscoder,
): Promise<ListeningFiles> {
  const key = path.resolve(sessionDir);
  const running = pending.get(key);
  if (running) return running;
  const job = build(sessionDir, source, transcode).finally(() =>
    pending.delete(key),
  );
  pending.set(key, job);
  return job;
}
