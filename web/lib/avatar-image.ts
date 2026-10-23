import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { AVATAR } from "./avatar-config";

/**
 * Photo de profil : de l'octet reçu au JPEG servi.
 *
 *  1. `sniffImage` lit le TYPE dans le contenu (octets magiques) et les dimensions dans l'en-tête ;
 *     ni l'extension ni l'en-tête `Content-Type` ne comptent. SVG, GIF, HTML… : refus (415).
 *  2. `AvatarEncoder` (port) réencode en JPEG carré 256×256 sans métadonnées. L'adaptateur de
 *     production est `ffmpegEncoder` (ffmpeg est déjà requis par l'atelier : aucune dépendance de
 *     plus). Réencoder détruit toute charge utile cachée (EXIF, commentaires, SVG collé après un
 *     JPEG) : seul un JPEG fabriqué par nous est stocké et servi.
 *  3. `prepareAvatar` orchestre et traduit chaque échec en code HTTP + message lisible.
 */
export type ImageKind = "jpeg" | "png" | "webp";
export type SniffedImage = { kind: ImageKind; width: number; height: number };
export type SniffResult =
  | { ok: true; image: SniffedImage }
  | { ok: false; reason: "format" | "corrupt" | "dimensions" | "too_small" };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const startsWith = (bytes: Uint8Array, magic: number[], at = 0): boolean =>
  bytes.length >= at + magic.length && magic.every((b, i) => bytes[at + i] === b);
const ascii = (bytes: Uint8Array, at: number, text: string): boolean =>
  startsWith(
    bytes,
    [...text].map((c) => c.charCodeAt(0)),
    at,
  );
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u24le = (b: Uint8Array, at: number) =>
  b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const u32be = (b: Uint8Array, at: number) =>
  ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;

/** Dimensions d'un JPEG : premier segment SOF (les autres segments sont sautés d'après leur longueur). */
function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // octets de remplissage
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      at += 2; // marqueurs sans longueur
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // fin / début des données avant tout SOF
    const length = u16be(bytes, at + 2);
    const sof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (sof) {
      if (length < 8 || at + 9 > bytes.length) return null;
      return { height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) };
    }
    if (length < 2) return null;
    at += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 12, "VP8X"))
    return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
  if (ascii(bytes, 12, "VP8L")) {
    if (bytes[20] !== 0x2f) return null;
    const b = [bytes[21], bytes[22], bytes[23], bytes[24]];
    return {
      width: 1 + (b[0] | ((b[1] & 0x3f) << 8)),
      height: 1 + ((b[1] >> 6) | (b[2] << 2) | ((b[3] & 0x0f) << 10)),
    };
  }
  if (ascii(bytes, 12, "VP8 ")) {
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null;
    return {
      width: u16le(bytes, 26) & 0x3fff,
      height: u16le(bytes, 28) & 0x3fff,
    };
  }
  return null;
}

/** Type et dimensions d'après le contenu. Jamais d'exception : un refus porte sa raison. */
export function sniffImage(bytes: Uint8Array): SniffResult {
  let kind: ImageKind;
  let size: { width: number; height: number } | null;
  if (startsWith(bytes, PNG_MAGIC)) {
    kind = "png";
    size =
      bytes.length >= 24 && ascii(bytes, 12, "IHDR")
        ? { width: u32be(bytes, 16), height: u32be(bytes, 20) }
        : null;
  } else if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    kind = "jpeg";
    size = jpegSize(bytes);
  } else if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) {
    kind = "webp";
    size = webpSize(bytes);
  } else return { ok: false, reason: "format" };
  if (!size) return { ok: false, reason: "corrupt" };
  const { width, height } = size;
  if (width < 1 || height < 1) return { ok: false, reason: "corrupt" };
  if (
    width > AVATAR.maxSide ||
    height > AVATAR.maxSide ||
    width * height > AVATAR.maxPixels
  )
    return { ok: false, reason: "dimensions" };
  if (Math.min(width, height) < AVATAR.minSide)
    return { ok: false, reason: "too_small" };
  return { ok: true, image: { kind, width, height } };
}

/** L'image ne se décode pas (corrompue, tronquée, animée non prise en charge…). */
export class ImageCorrupt extends Error {
  constructor() {
    super("image illisible");
    this.name = "ImageCorrupt";
  }
}
/** Le réencodeur n'est pas disponible sur ce serveur (ffmpeg introuvable). */
export class EncoderUnavailable extends Error {
  constructor() {
    super("réencodeur d'images indisponible");
    this.name = "EncoderUnavailable";
  }
}

/** Port : réencode une image reconnue en JPEG carré, sans métadonnées. */
export interface AvatarEncoder {
  encode(bytes: Uint8Array, kind: ImageKind): Promise<Uint8Array>;
}

const DECODERS: Record<ImageKind, string> = {
  jpeg: "mjpeg",
  png: "png",
  webp: "webp",
};

export function ffmpegCommand(): string {
  return process.env.AQR_FFMPEG || "ffmpeg";
}

/**
 * Filtre : recadrage « couvrir » au centre en carré, puis aplatissement sur un fond uni (le JPEG
 * n'a pas de transparence), sortie en YUV 4:2:0 plein débattement (JPEG standard).
 */
export function avatarFilter(size = AVATAR.size): string {
  return [
    `[0:v]scale=${size}:${size}:force_original_aspect_ratio=increase:flags=lanczos,crop=${size}:${size},format=rgba[fg]`,
    `color=c=${AVATAR.flattenColor}:s=${size}x${size}:r=1,format=rgba[bg]`,
    "[bg][fg]overlay=format=auto:shortest=1,format=yuvj420p",
  ].join(";");
}

/**
 * Adaptateur ffmpeg. Précautions : le format d'entrée est IMPOSÉ (`-f image2pipe -c:v <décodeur>`,
 * jamais deviné par ffmpeg), seul le protocole `pipe` est autorisé (aucune lecture de fichier local
 * ni de réseau, quel que soit le contenu), une seule image est lue, les métadonnées ne sont pas
 * recopiées, et le processus est limité en durée et en volume de sortie.
 */
export const ffmpegEncoder: AvatarEncoder = {
  encode(bytes, kind) {
    return new Promise((resolve, reject) => {
      const args = [
        "-hide_banner", "-loglevel", "error",
        "-protocol_whitelist", "pipe",
        "-f", "image2pipe", "-c:v", DECODERS[kind], "-i", "pipe:0",
        "-map_metadata", "-1", "-frames:v", "1", "-an", "-sn", "-dn",
        "-filter_complex", avatarFilter(),
        "-c:v", "mjpeg", "-q:v", String(AVATAR.jpegQuality),
        "-flags:v", "+bitexact", "-fflags", "+bitexact",
        "-f", "image2pipe", "pipe:1",
      ]; // prettier-ignore
      let child;
      try {
        child = spawn(ffmpegCommand(), args, {
          stdio: ["pipe", "pipe", "ignore"],
          windowsHide: true,
        });
      } catch {
        reject(new EncoderUnavailable());
        return;
      }
      const out: Buffer[] = [];
      let total = 0;
      let settled = false;
      const finish = (action: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        action();
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(() => reject(new ImageCorrupt()));
      }, AVATAR.encodeTimeoutMs);
      child.on("error", (error: NodeJS.ErrnoException) =>
        finish(() =>
          reject(error.code === "ENOENT" ? new EncoderUnavailable() : error),
        ),
      );
      child.stdout.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > AVATAR.maxOutputBytes) {
          child.kill("SIGKILL");
          finish(() => reject(new ImageCorrupt()));
          return;
        }
        out.push(chunk);
      });
      child.on("close", (code) =>
        finish(() =>
          code === 0 && total > 0
            ? resolve(Buffer.concat(out))
            : reject(new ImageCorrupt()),
        ),
      );
      // ffmpeg peut se fermer avant d'avoir tout lu : l'écriture échoue alors, sans importance.
      child.stdin.on("error", () => undefined);
      child.stdin.end(Buffer.from(bytes));
    });
  },
};

export type AvatarOutcome =
  | { ok: true; jpeg: Uint8Array; hash: string }
  | {
      ok: false;
      status: 400 | 413 | 415 | 422 | 503;
      code: "empty" | "too_large" | "format" | "corrupt" | "dimensions" | "unavailable";
      message: string;
    };

const REFUSALS = {
  empty: [400, "Aucune image reçue."],
  too_large: [
    413,
    `Image trop lourde : ${AVATAR.maxBytes / (1024 * 1024)} Mo au maximum.`,
  ],
  format: [415, "Format non pris en charge : choisis une image JPEG, PNG ou WebP."],
  corrupt: [422, "Cette image est illisible ou abîmée : essaie-en une autre."],
  dimensions: [
    422,
    `Dimensions refusées : de ${AVATAR.minSide} à ${AVATAR.maxSide} px de côté.`,
  ],
  unavailable: [
    503,
    "Le traitement des images est indisponible sur ce serveur (ffmpeg introuvable).",
  ],
} as const;

const refuse = (code: keyof typeof REFUSALS): AvatarOutcome => ({
  ok: false,
  status: REFUSALS[code][0],
  code,
  message: REFUSALS[code][1],
});

/** Empreinte (version) d'une image servie. */
export const avatarHash = (jpeg: Uint8Array): string =>
  createHash("sha256").update(jpeg).digest("hex").slice(0, AVATAR.hashLength);

/** Garde de sortie : un vrai JPEG, borné. */
const looksLikeJpeg = (b: Uint8Array): boolean =>
  b.length >= 4 &&
  b.length <= AVATAR.maxOutputBytes &&
  b[0] === 0xff &&
  b[1] === 0xd8 &&
  b[b.length - 2] === 0xff &&
  b[b.length - 1] === 0xd9;

export async function prepareAvatar(
  bytes: Uint8Array,
  encoder: AvatarEncoder = ffmpegEncoder,
): Promise<AvatarOutcome> {
  if (bytes.length === 0) return refuse("empty");
  if (bytes.length > AVATAR.maxBytes) return refuse("too_large");
  const sniffed = sniffImage(bytes);
  if (!sniffed.ok)
    return refuse(
      sniffed.reason === "too_small" ? "dimensions" : sniffed.reason,
    );
  try {
    const jpeg = await encoder.encode(bytes, sniffed.image.kind);
    if (!looksLikeJpeg(jpeg)) return refuse("corrupt");
    return { ok: true, jpeg, hash: avatarHash(jpeg) };
  } catch (error) {
    if (error instanceof EncoderUnavailable) return refuse("unavailable");
    if (error instanceof ImageCorrupt) return refuse("corrupt");
    throw error;
  }
}
