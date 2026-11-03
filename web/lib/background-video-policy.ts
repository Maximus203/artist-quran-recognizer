/**
 * Vidéo de fond choisie par l'utilisateur : ce que l'atelier accepte et comment il le dit. Fonctions pures,
 * partagées par le serveur (qui refuse) et le navigateur (qui prévient AVANT d'envoyer un octet) : les
 * plafonds et les phrases ne sont écrits qu'ici.
 *
 * Le fichier choisi est envoyé au serveur parce que l'export est rendu là-bas (navigateur sans interface) :
 * un fichier resté sur l'appareil n'atteindrait jamais le rendu. Le serveur le prépare une fois (image seule,
 * H.264, 1080p au plus) : la vidéo de fond est MUETTE, seul le son de la récitation est exporté.
 */
import { formatBytesFr, formatDurationFr } from "./format";

/** Conteneurs acceptés : le serveur les relit (ffmpeg), le navigateur de l'appareil n'a donc pas à les lire tous. */
export const CLIP_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".mkv",
  ".avi",
]);
/** Pour l'attribut `accept` du sélecteur de fichiers. */
export const CLIP_ACCEPT = [...CLIP_EXTENSIONS].join(",");
const FORMAT_NAMES = [...CLIP_EXTENSIONS]
  .map((extension) => extension.slice(1).toUpperCase())
  .join(", ");

export type ClipLimits = {
  /** Poids maximal du fichier envoyé (octets). */
  maxBytes: number;
  /** Durée maximale de la vidéo (secondes). */
  maxSeconds: number;
  /** Vidéos de fond gardées en même temps sur le serveur, par compte. */
  maxClips: number;
};

const MIB = 1024 * 1024;
export const DEFAULT_CLIP_LIMITS: ClipLimits = {
  maxBytes: 500 * MIB,
  maxSeconds: 10 * 60,
  maxClips: 3,
};

/** Plus grand côté d'image accepté (px) : au-delà, le décodage coûterait trop de mémoire au serveur (8K = 7 680). */
export const MAX_PICTURE_SIDE = 7680;

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const value = Number(raw);
  return raw !== undefined && Number.isInteger(value) && value > 0
    ? value
    : fallback;
};

/** Plafonds réglables (`AQR_MAX_BACKGROUND_VIDEO_BYTES`, `…_SECONDS`, `AQR_MAX_BACKGROUND_VIDEOS`). */
export function parseClipLimits(
  env: Record<string, string | undefined>,
): ClipLimits {
  return {
    maxBytes: positiveInt(
      env.AQR_MAX_BACKGROUND_VIDEO_BYTES,
      DEFAULT_CLIP_LIMITS.maxBytes,
    ),
    maxSeconds: positiveInt(
      env.AQR_MAX_BACKGROUND_VIDEO_SECONDS,
      DEFAULT_CLIP_LIMITS.maxSeconds,
    ),
    maxClips: positiveInt(
      env.AQR_MAX_BACKGROUND_VIDEOS,
      DEFAULT_CLIP_LIMITS.maxClips,
    ),
  };
}

/** Les limites en une phrase, à montrer AVANT le choix du fichier. */
export function clipLimitsText(limits: ClipLimits): string {
  return `${FORMAT_NAMES} · ${formatBytesFr(limits.maxBytes)} et ${formatDurationFr(limits.maxSeconds)} au plus. La vidéo de fond est muette : seul le son de la récitation est exporté.`;
}

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

/** Le nom annonce-t-il un conteneur vidéo accepté ? (Le contenu réel est contrôlé par le serveur.) */
export function isClipName(name: string): boolean {
  return CLIP_EXTENSIONS.has(extensionOf(name));
}

/** Raisons d'un refus ou d'un échec, communes au serveur et au navigateur. */
export type ClipCode =
  | "format"
  | "empty"
  | "too_big"
  | "too_long"
  | "too_wide"
  | "no_duration"
  | "unreadable"
  | "no_video"
  | "network"
  | "disk_full"
  | "too_many"
  | "missing"
  | "session_missing"
  | "not_ready"
  | "interrupted"
  | "server";

export type ClipProblem = { code: ClipCode; message: string };

type Context = { limits?: ClipLimits; size?: number; seconds?: number };

/**
 * L'explication en clair : ce qui ne va pas, ce que cela change pour la vidéo exportée, ce qu'il faut faire.
 * Jamais un code brut, un nom de variable ou une commande.
 */
export function clipExplanation(code: ClipCode, context: Context): string {
  const limits = context.limits ?? DEFAULT_CLIP_LIMITS;
  const max = formatBytesFr(limits.maxBytes);
  const maxTime = formatDurationFr(limits.maxSeconds);
  switch (code) {
    case "format":
      return `Ce format de fichier n'est pas accepté. La vidéo de fond n'est pas utilisée et l'export garde le fond précédent. Choisis un fichier ${FORMAT_NAMES}.`;
    case "empty":
      return "Ce fichier est vide. La vidéo de fond n'est pas utilisée et l'export garde le fond précédent. Choisis un autre fichier.";
    case "too_big":
      return `Ce fichier est trop lourd${context.size ? ` (${formatBytesFr(context.size)})` : ""} : le maximum est ${max}. La vidéo de fond n'est pas utilisée. Choisis une vidéo plus légère, ou raccourcis-la avant de l'envoyer.`;
    case "too_long":
      return `Cette vidéo est trop longue${context.seconds ? ` (${formatDurationFr(context.seconds)})` : ""} : le maximum est ${maxTime}. La vidéo de fond n'est pas utilisée. Coupe-la à ${maxTime} ou moins avant de la choisir.`;
    case "too_wide":
      return `Les images de cette vidéo sont démesurées (plus de ${MAX_PICTURE_SIDE} px de côté). Elle n'est pas utilisée. Réduis-la (1080p suffit pour l'export), puis choisis-la de nouveau.`;
    case "no_duration":
      return "On n'arrive pas à lire la durée de cette vidéo. Sans elle, on ne peut pas la caler sur la récitation. Essaie un autre fichier, de préférence en MP4.";
    case "unreadable":
      return "Cette vidéo est illisible ou abîmée. Elle ne peut pas servir de fond : l'export garde le fond précédent. Essaie un autre fichier, ou enregistre-la de nouveau (MP4 de préférence).";
    case "no_video":
      return "Ce fichier ne contient pas d'image (du son seulement). Il ne peut pas servir de fond. Choisis une vraie vidéo.";
    case "network":
      return "La connexion a été coupée pendant l'envoi. La vidéo de fond n'est pas encore sur le serveur, donc l'export ne l'utiliserait pas. Vérifie le réseau puis réessaie : ce qui était déjà envoyé n'est pas renvoyé.";
    case "disk_full":
      return "Le serveur n'a plus assez de place pour garder cette vidéo. Elle n'est pas utilisée. Réessaie plus tard ou préviens l'administrateur.";
    case "too_many":
      return `Tu as déjà ${limits.maxClips} vidéos de fond sur le serveur. Celle-ci n'a pas été envoyée. Retire une vidéo de fond, puis recommence.`;
    case "missing":
      return "Cette vidéo de fond n'est plus sur le serveur (supprimée ou expirée). Un export ne pourrait pas l'utiliser. Choisis-la de nouveau pour la renvoyer.";
    case "session_missing":
      return "Cet enregistrement n'est plus disponible pour ce compte (supprimé, ou réservé à un autre compte). Rien n'a été envoyé. Reviens à la liste des enregistrements.";
    case "not_ready":
      return "La vidéo de fond est encore en préparation sur le serveur. Elle n'est pas utilisable tout de suite. Patiente un instant : la préparation d'une longue vidéo prend quelques minutes.";
    case "interrupted":
      return "L'envoi a été interrompu. Ce qui avait été envoyé est supprimé du serveur. Choisis la vidéo de nouveau pour recommencer.";
    default:
      return "Le serveur n'a pas pu préparer cette vidéo. Elle n'est pas utilisée dans l'export. Réessaie ; si cela se répète, essaie un autre fichier ou préviens l'administrateur.";
  }
}

const problem = (code: ClipCode, context: Context): ClipProblem => ({
  code,
  message: clipExplanation(code, context),
});

/** Avant l'envoi : format annoncé, fichier non vide, poids. `null` = rien à redire. */
export function checkClipFile(
  file: { name: string; size: number },
  limits: ClipLimits,
): ClipProblem | null {
  if (!isClipName(file.name)) return problem("format", { limits });
  if (!(file.size > 0)) return problem("empty", { limits });
  if (file.size > limits.maxBytes)
    return problem("too_big", { limits, size: file.size });
  return null;
}

/** Durée lue sur la vidéo : positive, finie, sous le plafond. */
export function checkClipDuration(
  seconds: number,
  limits: ClipLimits,
): ClipProblem | null {
  if (!Number.isFinite(seconds) || !(seconds > 0))
    return problem("no_duration", { limits });
  if (seconds > limits.maxSeconds)
    return problem("too_long", { limits, seconds });
  return null;
}
