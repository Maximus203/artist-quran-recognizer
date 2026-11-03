/**
 * Outils média de la vidéo de fond (serveur) : sonde (ffprobe) et préparation (ffmpeg) d'un fichier envoyé par
 * un utilisateur. Le contenu vient d'une personne : le type est reconnu par la signature des premiers octets
 * (`media-sniff.ts`), puis le démultiplexeur est IMPOSÉ à ffprobe et ffmpeg (jamais deviné : une liste de
 * lecture ou un fichier de concaténation déguisé ne serait pas suivi), seul un fichier local est ouvert, la
 * durée traitée et le débit sont bornés. La sortie est une copie de rendu : image seule (la vidéo de fond est
 * muette), H.264, 1080p au plus, images clés rapprochées (le rendu se positionne image par image).
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ClipCode } from "./background-video-policy";
import { ffprobeCommand, tagDuration } from "./media-probe";
import {
  copyArgs,
  NO_VIDEO,
  parseVideoInfo,
  runFfmpeg,
} from "./video-browser-copy";

/** Refus d'un fichier, avec la raison à dire à l'utilisateur. */
export class ClipRejected extends Error {
  constructor(readonly code: ClipCode) {
    super(code);
    this.name = "ClipRejected";
  }
}

export type ClipProbe = {
  /** Durée (s) ; `null` quand le conteneur ne la dit pas (elle sera connue après la préparation). */
  duration: number | null;
  /** Taille affichée (rotation appliquée). */
  width: number;
  height: number;
  codec: string;
};

const FORMATS: Record<string, string> = {
  isobmff: "mov",
  matroska: "matroska",
  avi: "avi",
};

/** Démultiplexeur à imposer pour la famille reconnue par `sniffMedia` ; `null` si ce n'est pas une vidéo. */
export function inputFormatOf(family: string): string | null {
  return FORMATS[family] ?? null;
}

export function clipFfprobeArgs(file: string, format: string): string[] {
  return [
    "-v", "error", "-protocol_whitelist", "file", "-f", format, "-select_streams", "v:0",
    "-show_entries",
    "stream=codec_name,width,height,duration:stream_disposition=attached_pic:stream_tags=rotate,DURATION:stream_side_data=rotation:format=duration",
    "-of", "json", file,
  ]; // prettier-ignore
}

const positive = (raw: unknown): number | null => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Lit la sortie JSON de la sonde ; lève `ClipRejected` (`unreadable`, `no_video`). */
export function parseClipProbe(stdout: string): ClipProbe {
  const info = parseVideoInfo(stdout);
  if (info === null) throw new ClipRejected("unreadable");
  let parsed: {
    streams?: Array<{
      duration?: string;
      disposition?: { attached_pic?: number };
      tags?: Record<string, string>;
    }>;
    format?: { duration?: string };
  };
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new ClipRejected("unreadable");
  }
  const stream = parsed.streams?.[0];
  if (info === NO_VIDEO || stream?.disposition?.attached_pic === 1)
    throw new ClipRejected("no_video");
  return {
    duration:
      positive(parsed.format?.duration) ??
      positive(stream?.duration) ??
      tagDuration(stream?.tags),
    width: info.width,
    height: info.height,
    codec: info.codec,
  };
}

const exec = promisify(execFile);
const PROBE_TIMEOUT_MS = 60_000;

/** Sonde un fichier déjà reconnu comme conteneur vidéo. */
export async function ffprobeClip(
  file: string,
  format: string,
): Promise<ClipProbe> {
  let stdout: string;
  try {
    ({ stdout } = await exec(ffprobeCommand(), clipFfprobeArgs(file, format), {
      windowsHide: true,
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    }));
  } catch (error) {
    // ffprobe a tourné et n'a rien pu lire (code de sortie, délai) : le fichier est abîmé.
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new ClipRejected("server");
    throw new ClipRejected("unreadable");
  }
  return parseClipProbe(stdout);
}

/** Débit maximal de la copie : une vidéo de 10 min ne dépasse pas ~600 Mo, quel que soit l'original. */
const MAX_RATE = "8M";
const BUFFER = "16M";

export function clipFfmpegArgs(input: {
  source: string;
  output: string;
  format: string;
  maxSeconds: number;
}): string[] {
  return copyArgs(input.source, input.output, {
    inputFormat: input.format,
    localOnly: true,
    // Une seconde de plus que le plafond : si la vidéo est plus longue, la sortie le montre et on refuse.
    limitSeconds: input.maxSeconds + 1,
    maxrate: MAX_RATE,
    bufsize: BUFFER,
  });
}

/** Prépare la copie de rendu (muette, H.264, 1080p au plus). Rejette si ffmpeg ne peut pas décoder la source. */
export async function normalizeClip(input: {
  source: string;
  output: string;
  format: string;
  maxSeconds: number;
  /** Durée connue de la source (pour le pourcentage) ; sinon on se base sur le plafond. */
  duration: number | null;
  onRatio: (ratio: number) => void;
  signal?: AbortSignal;
}): Promise<void> {
  await runFfmpeg(clipFfmpegArgs(input), {
    duration: input.duration ?? input.maxSeconds,
    onRatio: input.onRatio,
    signal: input.signal,
  });
}
