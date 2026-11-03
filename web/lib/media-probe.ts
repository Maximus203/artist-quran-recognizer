/**
 * Sonde d'un fichier importé (ffprobe) : durée de l'audio et présence d'une piste audio.
 *
 * Sert à deux choses à l'import : refuser proprement une vidéo muette (au lieu d'une analyse qui
 * échouerait plus tard) et connaître la durée de l'audio pour estimer le temps de traitement. La
 * durée sondée est une estimation du conteneur ; elle est remplacée, à la fin de l'analyse, par la
 * valeur exacte du moteur (`source.duration_s`).
 *
 * Même recherche de ffprobe que le moteur (`FfmpegAudioExtractor`) : `AQR_FFMPEG` désigne ffmpeg,
 * ffprobe est son voisin ; sans réglage, celui du PATH. Sans ffprobe, rien n'est inventé : le fichier
 * est accepté sans durée (et sans estimation) ; c'est le moteur qui refusera un fichier sans audio.
 */
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export type MediaProbe = {
  duration_s: number | null;
  has_audio: boolean;
  has_video: boolean;
};

/** Refus lisible à renvoyer à l'utilisateur (vidéo muette, fichier illisible). */
export class MediaRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaRejected";
  }
}

const TIMEOUT_MS = 60_000;

export function ffprobeCommand(): string {
  if (process.env.AQR_FFPROBE) return process.env.AQR_FFPROBE;
  const ffmpeg = process.env.AQR_FFMPEG;
  if (ffmpeg && path.dirname(ffmpeg) !== ".")
    return path.join(path.dirname(ffmpeg), `ffprobe${path.extname(ffmpeg)}`);
  return "ffprobe";
}

/** Exécute ffprobe et renvoie sa sortie JSON ; rejette avec `code` (nombre = sortie en erreur). */
export type ProbeRunner = (file: string) => Promise<string>;
const exec = promisify(execFile);
export const ffprobeRunner: ProbeRunner = async (file) => {
  const { stdout } = await exec(
    ffprobeCommand(),
    [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type,duration:stream_tags=DURATION",
      "-of", "json",
      file,
    ], // prettier-ignore
    { windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
  );
  return stdout;
};

/** Étiquette `DURATION` (`hh:mm:ss.ffffff`) des pistes Matroska/WebM, dont `duration` vaut `N/A`. */
function tagDuration(tags: Record<string, string> | undefined): number | null {
  const match = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(
    tags?.DURATION ?? tags?.duration ?? "",
  );
  if (!match) return null;
  const seconds =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return seconds > 0 ? seconds : null;
}

export function parseProbe(stdout: string): MediaProbe {
  let value: {
    streams?: Array<{
      codec_type?: string;
      duration?: string;
      tags?: Record<string, string>;
    }>;
    format?: { duration?: string };
  };
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new Error("Sortie ffprobe illisible");
  }
  const streams = value.streams ?? [];
  const audio = streams.find((s) => s.codec_type === "audio");
  const positive = (raw: string | undefined) => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return {
    // La piste audio d'abord : dans une vidéo, le conteneur peut durer plus longtemps que le son
    // (mesuré : 10,3 s de conteneur pour 4,6 s d'audio), et seul le son est analysé.
    duration_s:
      positive(audio?.duration) ??
      tagDuration(audio?.tags) ??
      positive(value.format?.duration),
    has_audio: audio !== undefined,
    has_video: streams.some((s) => s.codec_type === "video"),
  };
}

const VIDEO_ONLY = new Set([".mp4", ".mkv", ".mov", ".avi", ".m4v"]);

/**
 * Contrôle d'un fichier déjà écrit sur le disque. Renvoie la durée sondée (`null` si inconnue).
 * `probed: false` = rien n'a pu être vérifié (ffprobe absent) : accepté sans durée.
 */
export async function inspectUpload(
  file: string,
  extension: string,
  run: ProbeRunner = ffprobeRunner,
): Promise<{ duration_s: number | null; probed: boolean }> {
  const isVideo = VIDEO_ONLY.has(extension.toLowerCase());
  let probe: MediaProbe;
  try {
    probe = parseProbe(await run(file));
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === "ENOENT") return { duration_s: null, probed: false };
    const unreadable =
      typeof code === "number" ||
      (error as { killed?: boolean }).killed === true ||
      (error instanceof Error && error.message === "Sortie ffprobe illisible");
    if (!unreadable) throw error;
    // ffprobe a tourné et n'a rien pu lire : ffmpeg ne le décodera pas non plus. Refus tout de suite
    // plutôt qu'un échec de l'analyse quelques secondes (ou minutes) plus tard.
    throw new MediaRejected(
      isVideo
        ? "Cette vidéo est illisible ou corrompue : impossible d'en extraire l'audio."
        : "Ce fichier audio est illisible ou corrompu : impossible de l'analyser.",
    );
  }
  if (!probe.has_audio)
    throw new MediaRejected(
      isVideo
        ? "Cette vidéo ne contient aucune piste audio : il n'y a rien à analyser."
        : "Ce fichier ne contient aucune piste audio : il n'y a rien à analyser.",
    );
  return { duration_s: probe.duration_s, probed: true };
}
