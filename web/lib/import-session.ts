/**
 * Import d'un audio ou d'une vidéo dans l'atelier (couche application de `POST /api/sessions`).
 *
 * Deux entrées, un seul chemin de création :
 * - `importFromStream` : le fichier arrive en flux brut (en-tête `x-aqr-filename`) et va
 *   directement sur le disque, empreinte calculée au vol. C'est le seul moyen raisonnable pour une
 *   vidéo de plusieurs centaines de Mo : le formulaire multipart, lui, est lu entièrement en mémoire ;
 * - `importFromBytes` : audio reçu par formulaire, avec un résultat `aqr.recognition/1` facultatif.
 *
 * Dans les deux cas le fichier est sondé (ffprobe) : une vidéo sans piste audio est refusée (422) et
 * rien n'est conservé ; la durée de l'audio est consignée pour estimer le temps de traitement.
 */
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { acceptedMediaExtensions, isVideoName } from "./audio-upload";
import { ensureListening } from "./listening";
import { inspectUpload, MediaRejected } from "./media-probe";
import { parseRecognition, type Recognition } from "./recognition";
import { engineFromLabel } from "./session-meta";
import {
  saveSession,
  sessionDir,
  sha,
  uploadLimitBytes,
  videoUploadLimitBytes,
  type Session,
} from "./store";

/** Refus d'import avec son code HTTP et un message lisible (jamais une trace technique). */
export class ImportError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ImportError";
    this.status = status;
  }
}

export type ImportDeps = {
  probe: (
    file: string,
    extension: string,
  ) => Promise<{ duration_s: number | null; probed: boolean }>;
  /** Prépare la copie d'écoute en tâche de fond (un échec est retenté à la première écoute). */
  prepareListening: (dir: string, extension: string) => void;
};

export const defaultImportDeps: ImportDeps = {
  probe: (file, extension) => inspectUpload(file, extension),
  prepareListening: (dir, extension) => {
    void ensureListening(dir, path.join(dir, `source${extension}`)).catch(
      () => {},
    );
  },
};

/** Plafond d'envoi selon le type : l'audio garde `AQR_MAX_UPLOAD_BYTES`, la vidéo a le sien. */
export function uploadLimitFor(extension: string): number {
  return isVideoName(`x${extension}`)
    ? videoUploadLimitBytes()
    : uploadLimitBytes();
}

const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} Mo`;
const tooLarge = (extension: string) =>
  new ImportError(
    413,
    `Fichier trop volumineux (maximum ${mb(uploadLimitFor(extension))}${
      isVideoName(`x${extension}`)
        ? ", réglable avec AQR_MAX_VIDEO_UPLOAD_BYTES"
        : ", réglable avec AQR_MAX_UPLOAD_BYTES"
    }).`,
  );

/** Nom de fichier sûr (sans chemin, 255 caractères au plus) et extension reconnue. */
export function sanitizeName(raw: string): { name: string; extension: string } {
  const name = path
    .basename(raw.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, 255);
  const extension = path.extname(name).toLowerCase();
  if (!acceptedMediaExtensions.has(extension))
    throw new ImportError(
      400,
      "Format non accepté : choisis un audio (MP3, M4A, WAV, OGG, OPUS, FLAC, AAC, WebM) ou une vidéo (MP4, MKV, MOV, AVI, M4V).",
    );
  return { name, extension };
}

/** Nom reçu dans l'en-tête `x-aqr-filename` (encodé en pourcentage, UTF-8). */
export function parseUploadName(header: string | null): {
  name: string;
  extension: string;
} {
  if (!header) throw new ImportError(400, "En-tête x-aqr-filename manquant.");
  let decoded: string;
  try {
    decoded = decodeURIComponent(header);
  } catch {
    throw new ImportError(400, "Nom de fichier mal encodé.");
  }
  return sanitizeName(decoded);
}

function parseSourceKind(value: string | null): "file" | "microphone" {
  if (value === null || value === "file") return "file";
  if (value === "microphone") return "microphone";
  throw new ImportError(400, "Origine audio invalide.");
}

class TooLarge extends Error {}

type Landed = {
  id: string;
  dir: string;
  name: string;
  extension: string;
  hash: string;
  size: number;
  sourceKind: "file" | "microphone";
  prediction: Buffer | null;
};

/** Sonde le fichier posé sur le disque, puis écrit la session ; supprime tout en cas de refus. */
async function register(landed: Landed, deps: ImportDeps): Promise<Session> {
  try {
    let parsed: Recognition | null = null;
    if (landed.prediction) {
      parsed = parseRecognition(JSON.parse(landed.prediction.toString("utf8")));
      if (parsed.source.sha256.toLowerCase() !== landed.hash)
        throw new ImportError(
          400,
          "Le SHA-256 du résultat ne correspond pas à l’audio.",
        );
      await writeFile(
        path.join(landed.dir, "prediction.recognition.json"),
        landed.prediction,
      );
    }
    let probed: { duration_s: number | null };
    try {
      probed = await deps.probe(
        path.join(landed.dir, `source${landed.extension}`),
        landed.extension,
      );
    } catch (error) {
      if (error instanceof MediaRejected)
        throw new ImportError(422, error.message);
      throw error;
    }
    const now = new Date().toISOString();
    const value: Session = {
      id: landed.id,
      name: landed.name,
      extension: landed.extension,
      audio_sha256: landed.hash,
      size: landed.size,
      source_kind: landed.sourceKind,
      created_at: now,
      state: landed.prediction ? "done" : "ready",
      error: null,
      started_at: null,
      finished_at: landed.prediction ? now : null,
      prediction_sha256: landed.prediction ? sha(landed.prediction) : null,
      pid: null,
      // La durée du moteur fait foi ; sinon l'estimation du conteneur (ou null : jamais inventée).
      audio_duration_s: parsed?.source.duration_s ?? probed.duration_s,
      ...(parsed ? { engine: engineFromLabel(parsed.engine.asr) } : {}),
      // Un résultat importé à la main est sous les yeux de l'utilisateur : pas de point « non lu ».
      viewed_at: landed.prediction ? now : null,
    };
    await saveSession(value);
    deps.prepareListening(landed.dir, landed.extension);
    return value;
  } catch (error) {
    await rm(landed.dir, { recursive: true, force: true });
    if (error instanceof ImportError) throw error;
    throw new ImportError(
      400,
      error instanceof Error ? error.message : "Import impossible",
    );
  }
}

export type StreamImport = {
  stream: ReadableStream<Uint8Array>;
  /** Valeur brute de l'en-tête `x-aqr-filename`. */
  filename: string | null;
  sourceKind: string | null;
  /** Valeur brute de `Content-Length` (ou null) : refus précoce d'un envoi trop gros. */
  contentLength: string | null;
};

export async function importFromStream(
  input: StreamImport,
  deps: ImportDeps = defaultImportDeps,
): Promise<Session> {
  const { name, extension } = parseUploadName(input.filename);
  const sourceKind = parseSourceKind(input.sourceKind);
  const limit = uploadLimitFor(extension);
  const declared = Number(input.contentLength);
  if (
    input.contentLength !== null &&
    (!Number.isFinite(declared) || declared > limit)
  ) {
    void input.stream.cancel().catch(() => undefined);
    throw tooLarge(extension);
  }
  const id = randomUUID();
  const dir = sessionDir(id);
  await mkdir(dir, { recursive: true });
  const hash = createHash("sha256");
  let size = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > limit) return done(new TooLarge());
      hash.update(chunk);
      done(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(
        input.stream as import("node:stream/web").ReadableStream,
      ),
      guard,
      createWriteStream(path.join(dir, `source${extension}`)),
    );
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    if (error instanceof TooLarge) throw tooLarge(extension);
    throw new ImportError(
      400,
      "Envoi interrompu : le fichier n'a pas été reçu en entier.",
    );
  }
  if (size === 0) {
    await rm(dir, { recursive: true, force: true });
    throw new ImportError(400, "Le fichier est vide.");
  }
  return register(
    {
      id,
      dir,
      name,
      extension,
      hash: hash.digest("hex"),
      size,
      sourceKind,
      prediction: null,
    },
    deps,
  );
}

export type BytesImport = {
  name: string;
  bytes: Buffer;
  sourceKind: string | null;
  prediction: Buffer | null;
};

export async function importFromBytes(
  input: BytesImport,
  deps: ImportDeps = defaultImportDeps,
): Promise<Session> {
  const { name, extension } = sanitizeName(input.name);
  const sourceKind = parseSourceKind(input.sourceKind);
  if (input.bytes.length === 0)
    throw new ImportError(400, "Le fichier est vide.");
  // Le formulaire est lu en mémoire : un seul plafond, celui de l'audio, pour tous les types.
  if (input.bytes.length > uploadLimitBytes())
    throw new ImportError(
      413,
      `Fichier trop volumineux pour un envoi par formulaire (maximum ${mb(uploadLimitBytes())}) : les fichiers volumineux, vidéos comprises, s'envoient en flux (en-tête x-aqr-filename).`,
    );
  const id = randomUUID();
  const dir = sessionDir(id);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(path.join(dir, `source${extension}`), input.bytes);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
  return register(
    {
      id,
      dir,
      name,
      extension,
      hash: sha(input.bytes),
      size: input.bytes.length,
      sourceKind,
      prediction: input.prediction,
    },
    deps,
  );
}
