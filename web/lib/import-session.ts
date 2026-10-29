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
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Transform, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Visibility } from "./access";
import { acceptedMediaExtensions, isVideoName } from "./audio-upload";
import { getDb } from "./db";
import { formatBytesFr } from "./format";
import { ensureListening } from "./listening";
import { DISK_FULL_MESSAGE, freeBytes, wouldFillDisk } from "./disk-space";
import { inspectUpload, MediaRejected } from "./media-probe";
import { SNIFF_BYTES, sniffMedia, type Sniff } from "./media-sniff";
import { parseRecognition, type Recognition } from "./recognition";
import { createMeta, deleteMeta, type NewMeta } from "./session-index";
import { engineFromLabel } from "./session-meta";
import { cleanUserName, defaultSessionName } from "./session-name";
import {
  formUploadLimitBytes,
  reviewRoot,
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

/** Propriétaire d'un import : qui, quelle portée, quel nom choisi, et le quota restant. */
export type ImportOwner = {
  ownerId: number;
  visibility: Visibility;
  /** Nom choisi par l'utilisateur ; null = nom par défaut dérivé du fichier. */
  name: string | null;
  /** Octets déjà occupés / plafond (`null` = illimité). */
  quota: { limit: number; used: number } | null;
};

export type ImportDeps = {
  /** Inscrit propriétaire, portée et nom AVANT que la session existe sur le disque (jamais de fenêtre « globale »). */
  claim: (meta: NewMeta) => void;
  release: (id: string) => void;
  probe: (
    file: string,
    extension: string,
  ) => Promise<{ duration_s: number | null; probed: boolean }>;
  /** Prépare la copie d'écoute en tâche de fond (un échec est retenté à la première écoute). */
  prepareListening: (dir: string, extension: string) => void;
  /** Type réel du fichier posé sur le disque (signature des premiers octets). */
  sniff: (file: string) => Promise<Sniff>;
  /** Octets libres sur le volume des sessions (`null` : inconnu). */
  freeBytes: (dir: string) => Promise<number | null>;
};

/** Premiers octets d'un fichier, pour en reconnaître le type. */
async function sniffFile(file: string): Promise<Sniff> {
  const handle = await open(file, "r");
  try {
    const head = Buffer.alloc(SNIFF_BYTES);
    const { bytesRead } = await handle.read(head, 0, SNIFF_BYTES, 0);
    return sniffMedia(head.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** Résultat joint (JSON `aqr.recognition/1`) : lu en mémoire, donc borné (les vrais pèsent quelques Mio). */
const MAX_PREDICTION_BYTES = 25 * 1024 * 1024;

export const defaultImportDeps: ImportDeps = {
  claim: (meta) => createMeta(getDb(), meta),
  release: (id) => deleteMeta(getDb(), id),
  probe: (file, extension) => inspectUpload(file, extension),
  sniff: sniffFile,
  freeBytes,
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
  const base = path
    .basename(raw.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    // Retournement du sens d'écriture, caractères de largeur nulle : « recitation<U+202E>fdp.mp3 »
    // s'afficherait « recitation3pm.pdf ».
    .replace(/[​-‏‪-‮⁠-⁩﻿]/g, "")
    // Points et espaces finaux : Windows les retire, le nom ne serait plus celui qu'on a validé.
    .replace(/[. ]+$/, "")
    .trim();
  const dot = base.lastIndexOf(".");
  const extension = dot >= 0 ? base.slice(dot).toLowerCase() : "";
  if (!acceptedMediaExtensions.has(extension))
    throw new ImportError(
      400,
      "Format non accepté : choisis un audio (MP3, M4A, WAV, OGG, OPUS, FLAC, AAC, WebM) ou une vidéo (MP4, MKV, MOV, AVI, M4V).",
    );
  const stem = base.slice(0, dot).trim();
  if (stem === "")
    throw new ImportError(
      400,
      "Le nom du fichier est vide : seule l'extension est présente.",
    );
  // Tronqué sur le nom, jamais sur l'extension (sinon un fichier valide devient « format non accepté »).
  return {
    name: `${stem.slice(0, 255 - extension.length)}${base.slice(dot)}`,
    extension,
  };
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
class QuotaExceeded extends Error {}

const quotaRefusal = (quota: { limit: number; used: number }) =>
  new ImportError(
    413,
    `Quota atteint : tu utilises ${formatBytesFr(quota.used)} sur ${formatBytesFr(quota.limit)}. Supprime des sessions pour libérer de la place.`,
  );
const remainingBytes = (owner: ImportOwner | undefined): number =>
  owner?.quota
    ? Math.max(0, owner.quota.limit - owner.quota.used)
    : Number.POSITIVE_INFINITY;

type Landed = {
  id: string;
  dir: string;
  name: string;
  extension: string;
  hash: string;
  size: number;
  sourceKind: "file" | "microphone";
  prediction: Buffer | null;
  owner?: ImportOwner;
};

/** Sonde le fichier posé sur le disque, puis écrit la session ; supprime tout en cas de refus. */
async function register(landed: Landed, deps: ImportDeps): Promise<Session> {
  try {
    // Le contenu d'abord : un fichier qui n'est pas un média n'atteint jamais ffprobe ni ffmpeg.
    const kind = await deps.sniff(
      path.join(landed.dir, `source${landed.extension}`),
    );
    if (!kind.ok) throw new ImportError(415, kind.message);
    let parsed: Recognition | null = null;
    if (landed.prediction) {
      try {
        parsed = parseRecognition(
          JSON.parse(landed.prediction.toString("utf8")),
        );
      } catch {
        // Ni la trace de l'analyseur JSON, ni le tableau d'erreurs de zod : l'utilisateur n'en fait rien.
        throw new ImportError(
          400,
          "Le résultat joint n'est pas un JSON aqr.recognition/1 valide.",
        );
      }
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
    if (landed.owner) {
      const chosen = cleanUserName(landed.owner.name);
      deps.claim({
        id: landed.id,
        ownerId: landed.owner.ownerId,
        name:
          chosen ??
          defaultSessionName(
            landed.name,
            now,
            landed.sourceKind,
            process.env.AQR_TIMEZONE || undefined,
          ),
        nameSource: chosen ? "user" : "auto",
        originalName: landed.name,
        sourceKind: landed.sourceKind,
        visibility: landed.owner.visibility,
        createdAt: now,
        sizeBytes: landed.size,
      });
    }
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
    if (landed.owner) deps.release(landed.id);
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
  owner?: ImportOwner;
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
  const remaining = remainingBytes(input.owner);
  if (input.owner?.quota && Number.isFinite(declared) && declared > remaining) {
    void input.stream.cancel().catch(() => undefined);
    throw quotaRefusal(input.owner.quota);
  }
  // Place disque : refus propre AVANT d'écrire quoi que ce soit (réserve de 1 Gio, `AQR_MIN_FREE_BYTES`).
  if (
    wouldFillDisk(
      await deps.freeBytes(reviewRoot()),
      input.contentLength !== null && Number.isFinite(declared) ? declared : 0,
    )
  ) {
    void input.stream.cancel().catch(() => undefined);
    throw new ImportError(507, DISK_FULL_MESSAGE);
  }
  const id = randomUUID();
  const dir = sessionDir(id);
  await mkdir(dir, { recursive: true });
  const hash = createHash("sha256");
  let size = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      size += chunk.length;
      if (size > remaining) return done(new QuotaExceeded());
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
    if (error instanceof QuotaExceeded && input.owner?.quota)
      throw quotaRefusal(input.owner.quota);
    // Disque plein en cours d'écriture : le dossier partiel est déjà retiré ci-dessus.
    if ((error as NodeJS.ErrnoException)?.code === "ENOSPC")
      throw new ImportError(507, DISK_FULL_MESSAGE);
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
      owner: input.owner,
    },
    deps,
  );
}

export type BytesImport = {
  name: string;
  bytes: Buffer;
  sourceKind: string | null;
  prediction: Buffer | null;
  owner?: ImportOwner;
};

export async function importFromBytes(
  input: BytesImport,
  deps: ImportDeps = defaultImportDeps,
): Promise<Session> {
  const { name, extension } = sanitizeName(input.name);
  const sourceKind = parseSourceKind(input.sourceKind);
  if (input.bytes.length === 0)
    throw new ImportError(400, "Le fichier est vide.");
  // Le formulaire est lu en mémoire : plafond propre (64 Mio), bien sous celui du flux.
  if (input.bytes.length > formUploadLimitBytes())
    throw new ImportError(
      413,
      `Fichier trop volumineux pour un envoi par formulaire (maximum ${mb(formUploadLimitBytes())}) : les fichiers volumineux, vidéos comprises, s'envoient en flux (en-tête x-aqr-filename).`,
    );
  if (input.prediction && input.prediction.length > MAX_PREDICTION_BYTES)
    throw new ImportError(
      413,
      `Le résultat joint est trop volumineux (maximum ${mb(MAX_PREDICTION_BYTES)}).`,
    );
  if (wouldFillDisk(await deps.freeBytes(reviewRoot()), input.bytes.length))
    throw new ImportError(507, DISK_FULL_MESSAGE);
  if (input.owner?.quota && input.bytes.length > remainingBytes(input.owner))
    throw quotaRefusal(input.owner.quota);
  const id = randomUUID();
  const dir = sessionDir(id);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(path.join(dir, `source${extension}`), input.bytes);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    if ((error as NodeJS.ErrnoException)?.code === "ENOSPC")
      throw new ImportError(507, DISK_FULL_MESSAGE);
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
      owner: input.owner,
    },
    deps,
  );
}
