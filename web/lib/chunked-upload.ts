import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { Visibility } from "./access";
import {
  chunkBytes,
  chunkStream,
  DEFAULT_CHUNK_BYTES,
  diskError,
  MAX_CHUNK_BYTES,
  planChunks,
  receivedIndexes,
  writeChunk,
  type ChunkPlan,
} from "./chunk-staging";
import { formatBytesFr } from "./format";
import {
  ImportError,
  defaultImportDeps,
  importFromStream,
  parseUploadName,
  uploadLimitFor,
  type ImportDeps,
} from "./import-session";
import { reviewRoot, type Session } from "./store";

/**
 * Envoi par morceaux. Le navigateur découpe le fichier ; chaque morceau est une requête courte, bien sous le
 * délai de lecture du proxy (60 s par défaut sur Traefik) : un téléphone en 4G peut envoyer un gros fichier sans
 * qu'aucune requête ne dépasse ce délai. Un morceau perdu se renvoie seul (reprise).
 *
 * Les morceaux attendent dans `<AQR_REVIEW_DIR>/uploads-staging/<id>/` (un fichier par morceau, nommé par le
 * serveur : aucun nom ne vient du client). À la fin, ils sont lus dans l'ordre et passés à `importFromStream` :
 * l'assemblage subit EXACTEMENT les mêmes contrôles que l'envoi en une requête (type réel, plafonds, quota,
 * place disque, sonde du média). Un envoi n'est visible que par son propriétaire (404 sinon, jamais 403).
 */
export { chunkBytes, DEFAULT_CHUNK_BYTES, MAX_CHUNK_BYTES };
export const MAX_ACTIVE_UPLOADS = 3;
export const UPLOAD_TTL_S = 24 * 3600;
const ID_RE = /^[0-9a-f]{32}$/;

const stagingRoot = () => path.join(reviewRoot(), "uploads-staging");
const dirOf = (id: string) => path.join(stagingRoot(), id);
const unknown = () => new ImportError(404, "Envoi inconnu ou expiré.");

type Meta = {
  id: string;
  ownerId: number;
  filename: string;
  extension: string;
  size: number;
  chunkSize: number;
  chunks: number;
  sourceKind: "file" | "microphone";
  visibility: Visibility;
  name: string | null;
  autorun: boolean;
  createdAt: string;
};

export type CreateUpload = {
  ownerId: number;
  /** Nom de fichier tel que le navigateur le connaît (décodé). */
  filename: string;
  size: number;
  sourceKind: string | null;
  visibility: Visibility;
  name: string | null;
  autorun: boolean;
  quota: { limit: number; used: number } | null;
};

export type Created = {
  id: string;
  chunkSize: number;
  chunks: number;
  size: number;
  expiresInS: number;
};

const planOf = (meta: Meta): ChunkPlan => planChunks(meta.size, meta.chunkSize);

async function readMeta(id: string, ownerId: number): Promise<Meta> {
  if (!ID_RE.test(id)) throw unknown();
  let meta: Meta;
  try {
    meta = JSON.parse(
      await readFile(path.join(dirOf(id), "meta.json"), "utf8"),
    );
  } catch {
    throw unknown();
  }
  if (meta.ownerId !== ownerId) throw unknown();
  return meta;
}

async function activeCount(ownerId: number): Promise<number> {
  let count = 0;
  for (const id of await readdir(stagingRoot()).catch(() => [])) {
    if (!ID_RE.test(id)) continue;
    try {
      const meta = JSON.parse(
        await readFile(path.join(dirOf(id), "meta.json"), "utf8"),
      ) as Meta;
      if (meta.ownerId === ownerId) count++;
    } catch {
      /* dossier en cours de création ou de retrait : ignoré */
    }
  }
  return count;
}

/** Retire les envois sans activité depuis plus de 24 h ; rend leur nombre. */
export async function cleanupStaleUploads(
  now = Date.now(),
  ttlS = UPLOAD_TTL_S,
): Promise<number> {
  let removed = 0;
  for (const id of await readdir(stagingRoot()).catch(() => [])) {
    if (!ID_RE.test(id)) continue;
    try {
      const { mtimeMs } = await stat(dirOf(id));
      if (now - mtimeMs > ttlS * 1000) {
        await rm(dirOf(id), { recursive: true, force: true });
        removed++;
      }
    } catch {
      /* déjà retiré */
    }
  }
  return removed;
}

export async function createUpload(input: CreateUpload): Promise<Created> {
  const { name: filename, extension } = parseUploadName(
    encodeURIComponent(input.filename),
  );
  if (
    input.sourceKind !== null &&
    input.sourceKind !== "file" &&
    input.sourceKind !== "microphone"
  )
    throw new ImportError(400, "Origine audio invalide.");
  const { size } = input;
  if (!Number.isInteger(size) || size <= 0)
    throw new ImportError(400, "Taille du fichier invalide.");
  const limit = uploadLimitFor(extension);
  if (size > limit)
    throw new ImportError(
      413,
      `Fichier trop volumineux (maximum ${formatBytesFr(limit)}).`,
    );
  if (input.quota && size > Math.max(0, input.quota.limit - input.quota.used))
    throw new ImportError(
      413,
      `Quota atteint : tu utilises ${formatBytesFr(input.quota.used)} sur ${formatBytesFr(input.quota.limit)}. Supprime des sessions pour libérer de la place.`,
    );
  await cleanupStaleUploads().catch(() => 0);
  if ((await activeCount(input.ownerId)) >= MAX_ACTIVE_UPLOADS)
    throw new ImportError(
      429,
      "Trop d'envois en cours : termine ou annule-en un avant d'en commencer un autre.",
    );
  const chunkSize = chunkBytes();
  const id = randomBytes(16).toString("hex");
  const meta: Meta = {
    id,
    ownerId: input.ownerId,
    filename,
    extension,
    size,
    chunkSize,
    chunks: planChunks(size, chunkSize).chunks,
    sourceKind: input.sourceKind === "microphone" ? "microphone" : "file",
    visibility: input.visibility,
    name: input.name,
    autorun: input.autorun,
    createdAt: new Date().toISOString(),
  };
  try {
    await mkdir(dirOf(id), { recursive: true, mode: 0o700 });
    await writeFile(path.join(dirOf(id), "meta.json"), JSON.stringify(meta));
  } catch (error) {
    await rm(dirOf(id), { recursive: true, force: true });
    throw diskError(error);
  }
  return {
    id,
    chunkSize,
    chunks: meta.chunks,
    size,
    expiresInS: UPLOAD_TTL_S,
  };
}

export async function receiveChunk(input: {
  id: string;
  ownerId: number;
  index: number;
  body: Buffer;
}): Promise<{ received: number; chunks: number }> {
  const meta = await readMeta(input.id, input.ownerId);
  const dir = dirOf(meta.id);
  await writeChunk(dir, planOf(meta), input.index, input.body);
  return {
    received: (await receivedIndexes(dir, planOf(meta))).length,
    chunks: meta.chunks,
  };
}

export async function uploadStatus(id: string, ownerId: number) {
  const meta = await readMeta(id, ownerId);
  return {
    id: meta.id,
    size: meta.size,
    chunkSize: meta.chunkSize,
    chunks: meta.chunks,
    received: await receivedIndexes(dirOf(meta.id), planOf(meta)),
  };
}

export async function abortUpload(id: string, ownerId: number): Promise<void> {
  const meta = await readMeta(id, ownerId);
  await rm(dirOf(meta.id), { recursive: true, force: true });
}

/** Assemble les morceaux et crée la session, avec les contrôles de l'envoi unique. */
export async function completeUpload(
  id: string,
  ownerId: number,
  deps: ImportDeps = defaultImportDeps,
  options: {
    sha256?: string | null;
    quota?: { limit: number; used: number } | null;
  } = {},
): Promise<{ session: Session; autorun: boolean }> {
  const meta = await readMeta(id, ownerId);
  const dir = dirOf(meta.id);
  const marker = path.join(dir, "completing");
  try {
    await (await open(marker, "wx")).close();
  } catch {
    throw new ImportError(409, "Assemblage déjà en cours.");
  }
  const release = () => rm(marker, { force: true });
  const present = await receivedIndexes(dir, planOf(meta));
  if (present.length !== meta.chunks) {
    await release();
    throw new ImportError(
      409,
      `Il manque des morceaux (${present.length} reçus sur ${meta.chunks}).`,
    );
  }
  if (options.sha256) {
    const hash = createHash("sha256");
    for await (const piece of chunkStream(dir, planOf(meta)))
      hash.update(piece);
    if (hash.digest("hex") !== options.sha256.toLowerCase()) {
      await rm(dir, { recursive: true, force: true });
      throw new ImportError(
        400,
        "Le fichier reçu ne correspond pas à l'empreinte annoncée : envoi à recommencer.",
      );
    }
  }
  try {
    const session = await importFromStream(
      {
        stream: Readable.toWeb(
          Readable.from(chunkStream(dir, planOf(meta))),
        ) as unknown as ReadableStream<Uint8Array>,
        filename: encodeURIComponent(meta.filename),
        sourceKind: meta.sourceKind,
        contentLength: String(meta.size),
        owner: {
          ownerId: meta.ownerId,
          visibility: meta.visibility,
          name: meta.name,
          quota: options.quota ?? null,
        },
      },
      deps,
    );
    await rm(dir, { recursive: true, force: true });
    return { session, autorun: meta.autorun };
  } catch (error) {
    // Un refus définitif (type, taille, quota) vide l'attente ; la place disque manquante laisse réessayer.
    if (error instanceof ImportError && error.status !== 507)
      await rm(dir, { recursive: true, force: true });
    else await release();
    throw error;
  }
}
