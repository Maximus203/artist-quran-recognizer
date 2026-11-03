import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ImportError, type ImportDeps } from "./import-session";
import {
  abortUpload,
  cleanupStaleUploads,
  completeUpload,
  createUpload,
  receiveChunk,
  uploadStatus,
} from "./chunked-upload";
import type { NewMeta } from "./session-index";

/**
 * Envoi par morceaux : le navigateur découpe le fichier, chaque morceau passe sous le délai de lecture du proxy
 * (60 s par défaut sur Traefik), l'assemblage se fait côté serveur avec les MÊMES contrôles que l'envoi unique.
 */
const CHUNK = 1024; // morceaux de 1 Kio dans les tests
let tmp = "";
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-chunks-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
  vi.stubEnv("AQR_UPLOAD_CHUNK_BYTES", String(CHUNK));
  vi.stubEnv("AQR_MIN_UPLOAD_CHUNK_BYTES", "256"); // le plancher de production ne gêne pas les tests
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

const claimed: NewMeta[] = [];
const deps = (over: Partial<ImportDeps> = {}): ImportDeps => ({
  probe: async () => ({ duration_s: 12, probed: true }),
  sniff: async () => ({ ok: true, family: "mp3" }),
  freeBytes: async () => null,
  prepareListening: () => undefined,
  claim: (meta) => void claimed.push(meta),
  release: () => undefined,
  ...over,
});
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const file = (size: number) =>
  Buffer.from(Array.from({ length: size }, (_, i) => (i * 7 + 3) % 251));
const parts = (data: Buffer) =>
  Array.from({ length: Math.ceil(data.length / CHUNK) }, (_, i) =>
    data.subarray(i * CHUNK, (i + 1) * CHUNK),
  );
const base = {
  ownerId: 1,
  filename: "récitation 1.mp3",
  sourceKind: null,
  visibility: "private" as const,
  name: null,
  autorun: false,
  quota: null,
};
const stagingEntries = async () =>
  readdir(path.join(tmp, "uploads-staging")).catch(() => []);

describe("création d'un envoi", () => {
  it("annonce la taille des morceaux et leur nombre", async () => {
    const created = await createUpload({ ...base, size: CHUNK * 3 + 10 });
    expect(created).toMatchObject({ chunkSize: CHUNK, chunks: 4 });
    expect(created.id).toMatch(/^[0-9a-f]{32}$/);
    expect(created.expiresInS).toBeGreaterThan(3600);
  });

  it("refuse un nom sans extension reconnue, une taille nulle ou démesurée", async () => {
    await expect(
      createUpload({ ...base, filename: "notes.txt", size: 10 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(createUpload({ ...base, size: 0 })).rejects.toBeInstanceOf(
      ImportError,
    );
    await expect(
      createUpload({ ...base, size: Number.NaN }),
    ).rejects.toBeInstanceOf(ImportError);
    await expect(
      createUpload({ ...base, size: 10 ** 13 }),
    ).rejects.toMatchObject({ status: 413 });
    expect(await stagingEntries()).toEqual([]); // rien n'a été posé sur le disque
  });

  it("refuse dès la création un fichier qui dépasse le quota restant", async () => {
    await expect(
      createUpload({ ...base, size: 5000, quota: { limit: 6000, used: 2000 } }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("borne le nombre d'envois en cours par compte", async () => {
    for (let i = 0; i < 3; i++) await createUpload({ ...base, size: 100 });
    await expect(createUpload({ ...base, size: 100 })).rejects.toMatchObject({
      status: 429,
    });
    // un autre compte n'est pas touché
    await expect(
      createUpload({ ...base, ownerId: 2, size: 100 }),
    ).resolves.toBeDefined();
  });
});

describe("réception des morceaux", () => {
  it("reçoit dans le désordre, et un morceau renvoyé est accepté sans doublon", async () => {
    const data = file(CHUNK * 2 + 100);
    const created = await createUpload({ ...base, size: data.length });
    const [p0, p1, p2] = parts(data);
    await receiveChunk({ id: created.id, ownerId: 1, index: 2, body: p2 });
    await receiveChunk({ id: created.id, ownerId: 1, index: 0, body: p0 });
    await receiveChunk({ id: created.id, ownerId: 1, index: 0, body: p0 }); // reprise
    expect(await uploadStatus(created.id, 1)).toMatchObject({
      received: [0, 2],
      chunks: 3,
    });
    await receiveChunk({ id: created.id, ownerId: 1, index: 1, body: p1 });
    expect((await uploadStatus(created.id, 1)).received).toEqual([0, 1, 2]);
  });

  it("refuse un numéro hors limites et une taille de morceau inattendue", async () => {
    const created = await createUpload({ ...base, size: CHUNK * 2 + 100 });
    const call = (index: number, size: number) =>
      receiveChunk({
        id: created.id,
        ownerId: 1,
        index,
        body: Buffer.alloc(size, 1),
      });
    await expect(call(3, 100)).rejects.toMatchObject({ status: 400 }); // numéro trop grand
    await expect(call(-1, 100)).rejects.toMatchObject({ status: 400 });
    await expect(call(0, CHUNK - 1)).rejects.toMatchObject({ status: 400 }); // trop court
    await expect(call(0, CHUNK + 1)).rejects.toMatchObject({ status: 413 }); // trop long
    await expect(call(2, 99)).rejects.toMatchObject({ status: 400 }); // dernier : 100 exactement
    expect((await uploadStatus(created.id, 1)).received).toEqual([]);
  });

  it("un envoi n'est visible et modifiable que par son propriétaire (404, jamais 403)", async () => {
    const created = await createUpload({ ...base, size: 100 });
    const body = Buffer.alloc(100, 1);
    await expect(
      receiveChunk({ id: created.id, ownerId: 2, index: 0, body }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(uploadStatus(created.id, 2)).rejects.toMatchObject({
      status: 404,
    });
    await expect(abortUpload(created.id, 2)).rejects.toMatchObject({
      status: 404,
    });
    await expect(completeUpload(created.id, 2, deps())).rejects.toMatchObject({
      status: 404,
    });
  });

  it("un identifiant qui n'est pas 32 hexadécimaux ne touche jamais le disque", async () => {
    for (const id of ["../x", "..%2Fx", "a".repeat(31), "G".repeat(32), ""]) {
      await expect(uploadStatus(id, 1)).rejects.toMatchObject({ status: 404 });
      await expect(
        receiveChunk({ id, ownerId: 1, index: 0, body: Buffer.alloc(1) }),
      ).rejects.toMatchObject({ status: 404 });
    }
  });
});

describe("assemblage", () => {
  it("assemble dans l'ordre et crée la session avec les contrôles de l'envoi unique", async () => {
    const data = file(CHUNK * 3 + 17);
    const created = await createUpload({ ...base, size: data.length });
    const p = parts(data);
    for (const i of [3, 1, 0, 2])
      await receiveChunk({
        id: created.id,
        ownerId: 1,
        index: i,
        body: p[i],
      });
    const done = await completeUpload(created.id, 1, deps());
    expect(done.session).toMatchObject({
      name: "récitation 1.mp3",
      size: data.length,
      audio_sha256: sha(data),
      state: "ready",
    });
    expect(done.autorun).toBe(false);
    const { sessionDir } = await import("./store");
    expect(
      sha(await readFile(path.join(sessionDir(done.session.id), "source.mp3"))),
    ).toBe(sha(data));
    expect(claimed.at(-1)).toMatchObject({ visibility: "private" });
    expect(await stagingEntries()).toEqual([]); // le dossier d'attente est retiré
  });

  it("refuse l'assemblage tant qu'il manque un morceau, et laisse reprendre", async () => {
    const data = file(CHUNK * 2);
    const created = await createUpload({ ...base, size: data.length });
    const p = parts(data);
    await receiveChunk({ id: created.id, ownerId: 1, index: 0, body: p[0] });
    await expect(completeUpload(created.id, 1, deps())).rejects.toMatchObject({
      status: 409,
    });
    await receiveChunk({ id: created.id, ownerId: 1, index: 1, body: p[1] });
    await expect(completeUpload(created.id, 1, deps())).resolves.toBeDefined();
  });

  it("l'empreinte annoncée est vérifiée : un contenu différent est refusé et nettoyé", async () => {
    const data = file(CHUNK);
    const created = await createUpload({ ...base, size: data.length });
    await receiveChunk({ id: created.id, ownerId: 1, index: 0, body: data });
    await expect(
      completeUpload(created.id, 1, deps(), { sha256: "0".repeat(64) }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await stagingEntries()).toEqual([]);
  });

  it("l'empreinte annoncée correcte est acceptée", async () => {
    const data = file(CHUNK + 5);
    const created = await createUpload({ ...base, size: data.length });
    const p = parts(data);
    await receiveChunk({ id: created.id, ownerId: 1, index: 0, body: p[0] });
    await receiveChunk({ id: created.id, ownerId: 1, index: 1, body: p[1] });
    const done = await completeUpload(created.id, 1, deps(), {
      sha256: sha(data),
    });
    expect(done.session.audio_sha256).toBe(sha(data));
  });

  it("un type de fichier faux est refusé comme pour l'envoi unique, sans rien garder", async () => {
    const data = file(CHUNK);
    const created = await createUpload({ ...base, size: data.length });
    await receiveChunk({ id: created.id, ownerId: 1, index: 0, body: data });
    await expect(
      completeUpload(
        created.id,
        1,
        deps({ sniff: async () => ({ ok: false, message: "pas un média" }) }),
      ),
    ).rejects.toBeInstanceOf(ImportError);
    expect(await stagingEntries()).toEqual([]);
  });

  it("un second assemblage en parallèle est refusé (409) : une seule session naît", async () => {
    const data = file(CHUNK);
    const created = await createUpload({ ...base, size: data.length });
    await receiveChunk({ id: created.id, ownerId: 1, index: 0, body: data });
    const before = claimed.length;
    const results = await Promise.allSettled([
      completeUpload(created.id, 1, deps()),
      completeUpload(created.id, 1, deps()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(claimed.length - before).toBe(1);
  });

  it("transmet l'intention d'analyse (autorun), la portée et le nom choisis à la création", async () => {
    const data = file(100);
    const created = await createUpload({
      ...base,
      size: data.length,
      autorun: true,
      visibility: "global",
      name: "Fatiha",
    });
    await receiveChunk({ id: created.id, ownerId: 1, index: 0, body: data });
    const done = await completeUpload(created.id, 1, deps());
    expect(done.autorun).toBe(true);
    expect(claimed.at(-1)).toMatchObject({
      visibility: "global",
      name: "Fatiha",
    });
  });
});

describe("abandon et nettoyage", () => {
  it("abandonner retire tout, et libère la place pour un nouvel envoi", async () => {
    const created = await createUpload({ ...base, size: 100 });
    await receiveChunk({
      id: created.id,
      ownerId: 1,
      index: 0,
      body: Buffer.alloc(100, 1),
    });
    await abortUpload(created.id, 1);
    expect(await stagingEntries()).toEqual([]);
    await expect(uploadStatus(created.id, 1)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("les envois abandonnés depuis plus de 24 h sont purgés, les récents gardés", async () => {
    const old = await createUpload({ ...base, size: 100 });
    const recent = await createUpload({ ...base, size: 100 });
    const dir = path.join(tmp, "uploads-staging", old.id);
    const past = new Date(Date.now() - 25 * 3600 * 1000);
    await utimes(dir, past, past);
    await utimes(path.join(dir, "meta.json"), past, past);
    expect(await cleanupStaleUploads()).toBe(1);
    expect(await stagingEntries()).toEqual([recent.id]);
    await expect(uploadStatus(old.id, 1)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("le dossier d'un envoi ne contient que des fichiers choisis par le serveur", async () => {
    const created = await createUpload({
      ...base,
      filename: "../../etc/passwd.mp3",
      size: 100,
    });
    await receiveChunk({
      id: created.id,
      ownerId: 1,
      index: 0,
      body: Buffer.alloc(100, 1),
    });
    const names = await readdir(path.join(tmp, "uploads-staging", created.id));
    expect(names.sort()).toEqual(["chunk-0.part", "meta.json"]);
    expect((await stat(path.join(tmp, "uploads-staging"))).isDirectory()).toBe(
      true,
    );
  });
});
