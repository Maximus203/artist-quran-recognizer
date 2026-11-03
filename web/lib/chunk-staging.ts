import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { DISK_FULL_MESSAGE } from "./disk-space";
import { ImportError } from "./import-session";

/**
 * Cœur des envois par morceaux, commun à l'import d'une session (`chunked-upload.ts`) et à la vidéo de fond
 * (`background-video-store.ts`) : le plan des morceaux, l'écriture atomique d'un morceau, la liste de ceux
 * déjà reçus et leur relecture bout à bout. Un morceau est écrit sous un nom choisi par le serveur
 * (`chunk-<n>.part`) : aucun nom ne vient du client. Chaque appelant garde ses propres règles (propriétaire,
 * plafonds, ce qu'on fait du fichier assemblé).
 */
export const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;
const MIN_CHUNK_BYTES = 256 * 1024;

/** Taille d'un morceau : 4 Mio par défaut, entre 256 Kio et 8 Mio (`AQR_UPLOAD_CHUNK_BYTES`). */
export function chunkBytes(
  env: Record<string, string | undefined> = process.env,
): number {
  const floor = Math.min(
    MIN_CHUNK_BYTES,
    Number(env.AQR_MIN_UPLOAD_CHUNK_BYTES) || MIN_CHUNK_BYTES,
  );
  const value = Number(env.AQR_UPLOAD_CHUNK_BYTES);
  return Number.isInteger(value) && value >= floor && value <= MAX_CHUNK_BYTES
    ? value
    : DEFAULT_CHUNK_BYTES;
}

/** Ce qu'il faut savoir pour recevoir un fichier en morceaux. */
export type ChunkPlan = { size: number; chunkSize: number; chunks: number };

export const planChunks = (size: number, chunkSize: number): ChunkPlan => ({
  size,
  chunkSize,
  chunks: Math.ceil(size / chunkSize),
});

/** Taille exacte attendue du morceau `index` : pleine, sauf le dernier. */
export const expectedLength = (plan: ChunkPlan, index: number): number =>
  index === plan.chunks - 1
    ? plan.size - (plan.chunks - 1) * plan.chunkSize
    : plan.chunkSize;

const partName = (index: number) => `chunk-${index}.part`;

export function diskError(error: unknown): ImportError {
  return (error as NodeJS.ErrnoException)?.code === "ENOSPC"
    ? new ImportError(507, DISK_FULL_MESSAGE)
    : new ImportError(500, "Envoi impossible pour l'instant.");
}

/** Écrit un morceau (atomique : entier ou absent). Renvoyer le même morceau remplace le précédent. */
export async function writeChunk(
  dir: string,
  plan: ChunkPlan,
  index: number,
  body: Buffer,
): Promise<void> {
  if (!Number.isInteger(index) || index < 0 || index >= plan.chunks)
    throw new ImportError(400, "Numéro de morceau hors limites.");
  const expected = expectedLength(plan, index);
  if (body.length > expected)
    throw new ImportError(413, "Morceau plus grand que prévu.");
  if (body.length !== expected)
    throw new ImportError(400, "Morceau incomplet : taille inattendue.");
  const target = path.join(dir, partName(index));
  const temp = `${target}.${randomBytes(4).toString("hex")}.tmp`;
  try {
    await writeFile(temp, body);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw diskError(error);
  }
}

/** Numéros des morceaux entiers déjà reçus, dans l'ordre. */
export async function receivedIndexes(
  dir: string,
  plan: ChunkPlan,
): Promise<number[]> {
  const found: number[] = [];
  for (const entry of await readdir(dir).catch(() => [])) {
    const match = /^chunk-(\d+)\.part$/.exec(entry);
    if (!match) continue;
    const index = Number(match[1]);
    if (index >= plan.chunks) continue;
    const { size } = await stat(path.join(dir, entry)).catch(() => ({
      size: -1,
    }));
    if (size === expectedLength(plan, index)) found.push(index);
  }
  return found.sort((a, b) => a - b);
}

/** Relit tous les morceaux, dans l'ordre, comme un seul flux. */
export async function* chunkStream(
  dir: string,
  plan: ChunkPlan,
): AsyncGenerator<Buffer> {
  for (let i = 0; i < plan.chunks; i++)
    for await (const piece of createReadStream(path.join(dir, partName(i))))
      yield piece as Buffer;
}
