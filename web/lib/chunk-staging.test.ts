import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  chunkBytes,
  chunkStream,
  expectedLength,
  planChunks,
  receivedIndexes,
  writeChunk,
} from "./chunk-staging";

/** Le cœur des envois par morceaux, commun à l'import de sessions et aux vidéos de fond. */
let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-staging-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const plan = planChunks(2500, 1000); // 1000 + 1000 + 500

describe("plan des morceaux", () => {
  it("découpe en morceaux pleins puis un dernier plus court", () => {
    expect(plan).toEqual({ size: 2500, chunkSize: 1000, chunks: 3 });
    expect(expectedLength(plan, 0)).toBe(1000);
    expect(expectedLength(plan, 1)).toBe(1000);
    expect(expectedLength(plan, 2)).toBe(500);
  });
  it("un fichier qui tient en un morceau n'a qu'un morceau, de sa taille", () => {
    const one = planChunks(10, 1000);
    expect(one.chunks).toBe(1);
    expect(expectedLength(one, 0)).toBe(10);
  });
});

describe("taille d'un morceau", () => {
  it("4 Mio par défaut, réglable entre 256 Kio et 8 Mio", () => {
    expect(chunkBytes({})).toBe(4 * 1024 * 1024);
    expect(chunkBytes({ AQR_UPLOAD_CHUNK_BYTES: String(1024 * 1024) })).toBe(
      1024 * 1024,
    );
    expect(chunkBytes({ AQR_UPLOAD_CHUNK_BYTES: "10" })).toBe(4 * 1024 * 1024);
    expect(
      chunkBytes({ AQR_UPLOAD_CHUNK_BYTES: String(64 * 1024 * 1024) }),
    ).toBe(4 * 1024 * 1024);
  });
});

describe("écriture et relecture des morceaux", () => {
  it("écrit un morceau entier, renvoie les morceaux reçus triés", async () => {
    await writeChunk(dir, plan, 2, Buffer.alloc(500, 3));
    await writeChunk(dir, plan, 0, Buffer.alloc(1000, 1));
    expect(await receivedIndexes(dir, plan)).toEqual([0, 2]);
  });

  it("renvoyer le même morceau est sans risque (reprise)", async () => {
    await writeChunk(dir, plan, 0, Buffer.alloc(1000, 1));
    await writeChunk(dir, plan, 0, Buffer.alloc(1000, 9));
    expect(await receivedIndexes(dir, plan)).toEqual([0]);
  });

  it("refuse un morceau hors limites, trop gros ou incomplet", async () => {
    await expect(
      writeChunk(dir, plan, 3, Buffer.alloc(500)),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      writeChunk(dir, plan, -1, Buffer.alloc(500)),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      writeChunk(dir, plan, 1, Buffer.alloc(1001)),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      writeChunk(dir, plan, 1, Buffer.alloc(999)),
    ).rejects.toMatchObject({ status: 400 });
    expect(await receivedIndexes(dir, plan)).toEqual([]);
  });

  it("ne compte pas un morceau de taille inattendue ni un fichier étranger", async () => {
    await writeFile(path.join(dir, "chunk-0.part"), Buffer.alloc(3));
    await writeFile(path.join(dir, "chunk-9.part"), Buffer.alloc(1000));
    await writeFile(path.join(dir, "notes.txt"), "x");
    expect(await receivedIndexes(dir, plan)).toEqual([]);
  });

  it("ne laisse aucun fichier temporaire derrière lui", async () => {
    await writeChunk(dir, plan, 0, Buffer.alloc(1000));
    expect((await readdir(dir)).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect((await stat(path.join(dir, "chunk-0.part"))).size).toBe(1000);
  });

  it("relit les morceaux dans l'ordre, bout à bout", async () => {
    await writeChunk(dir, plan, 1, Buffer.alloc(1000, 2));
    await writeChunk(dir, plan, 0, Buffer.alloc(1000, 1));
    await writeChunk(dir, plan, 2, Buffer.alloc(500, 3));
    const parts: Buffer[] = [];
    for await (const piece of chunkStream(dir, plan)) parts.push(piece);
    const all = Buffer.concat(parts);
    expect(all.length).toBe(2500);
    expect(all[0]).toBe(1);
    expect(all[1000]).toBe(2);
    expect(all[2499]).toBe(3);
  });
});
