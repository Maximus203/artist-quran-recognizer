import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  importFromBytes,
  importFromStream,
  type ImportDeps,
  type ImportOwner,
} from "./import-session";
import type { NewMeta } from "./session-index";

let tmp: string;
const claimed: NewMeta[] = [];
const released: string[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-import-owner-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
  claimed.length = 0;
  released.length = 0;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

const deps = (): ImportDeps => ({
  probe: async () => ({ duration_s: 12, probed: true }),
  prepareListening: () => undefined,
  claim: (meta) => void claimed.push(meta),
  release: (id) => void released.push(id),
});
const owner = (over: Partial<ImportOwner> = {}): ImportOwner => ({
  ownerId: 7,
  visibility: "global",
  name: null,
  quota: null,
  ...over,
});
const sessionIds = () => readdir(path.join(tmp, "sessions")).catch(() => []);

function streamOf(...chunks: Buffer[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(new Uint8Array(chunks[i++]));
      else controller.close();
    },
  });
}

describe("import avec propriétaire", () => {
  it("inscrit propriétaire, portée et nom par défaut avant la session", async () => {
    const created = await importFromBytes(
      {
        name: "Surah_Yusuf [dQw4w9WgXcQ].mp3",
        bytes: Buffer.from("audio"),
        sourceKind: null,
        prediction: null,
        owner: owner({ visibility: "private" }),
      },
      deps(),
    );
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      id: created.id,
      ownerId: 7,
      visibility: "private",
      name: "Surah Yusuf",
      nameSource: "auto",
      originalName: "Surah_Yusuf [dQw4w9WgXcQ].mp3",
      sizeBytes: 5,
    });
  });

  it("un nom choisi est gardé et marqué « user »", async () => {
    await importFromBytes(
      {
        name: "a.mp3",
        bytes: Buffer.from("audio"),
        sourceKind: null,
        prediction: null,
        owner: owner({ name: "  Mon   test " }),
      },
      deps(),
    );
    expect(claimed[0]).toMatchObject({ name: "Mon test", nameSource: "user" });
  });

  it("enregistrement au micro : nom horodaté", async () => {
    await importFromBytes(
      {
        name: "2026-10-22T17-51-03-120.webm",
        bytes: Buffer.from("audio"),
        sourceKind: "microphone",
        prediction: null,
        owner: owner(),
      },
      deps(),
    );
    expect(claimed[0].name).toMatch(
      /^Enregistrement du \d{1,2} \S+ à \d\d:\d\d$/,
    );
  });

  it("un import refusé ne laisse ni dossier ni ligne d'index", async () => {
    await expect(
      importFromBytes(
        {
          name: "a.mp3",
          bytes: Buffer.from("audio"),
          sourceKind: null,
          prediction: Buffer.from("{}"),
          owner: owner(),
        },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    // Refus avant l'inscription : aucune ligne créée, et la libération (idempotente) a bien lieu.
    expect(claimed).toEqual([]);
    expect(released).toHaveLength(1);
    expect(await sessionIds()).toEqual([]);
  });

  it("sans propriétaire (appel historique), rien n'est inscrit", async () => {
    await importFromBytes(
      {
        name: "a.mp3",
        bytes: Buffer.from("audio"),
        sourceKind: null,
        prediction: null,
      },
      deps(),
    );
    expect(claimed).toEqual([]);
  });
});

describe("quota par utilisateur", () => {
  const quota = { limit: 1000, used: 996 };
  const REFUSED = {
    status: 413,
    message: expect.stringContaining("Quota atteint"),
  };

  it("refuse en multipart un envoi qui dépasserait", async () => {
    await expect(
      importFromBytes(
        {
          name: "a.mp3",
          bytes: Buffer.alloc(10),
          sourceKind: null,
          prediction: null,
          owner: owner({ quota }),
        },
        deps(),
      ),
    ).rejects.toMatchObject(REFUSED);
  });

  it("refuse en flux, au vol et d'après Content-Length, sans rien conserver", async () => {
    await expect(
      importFromStream(
        {
          stream: streamOf(Buffer.alloc(3), Buffer.alloc(3)),
          filename: "a.mp3",
          sourceKind: null,
          contentLength: null,
          owner: owner({ quota }),
        },
        deps(),
      ),
    ).rejects.toMatchObject(REFUSED);
    await expect(
      importFromStream(
        {
          stream: streamOf(Buffer.alloc(6)),
          filename: "a.mp3",
          sourceKind: null,
          contentLength: "6",
          owner: owner({ quota }),
        },
        deps(),
      ),
    ).rejects.toMatchObject(REFUSED);
    expect(await sessionIds()).toEqual([]);
    expect(claimed).toEqual([]);
  });

  it("accepte ce qui tient, pile au plafond comprise", async () => {
    const ok = await importFromBytes(
      {
        name: "a.mp3",
        bytes: Buffer.alloc(4),
        sourceKind: null,
        prediction: null,
        owner: owner({ quota }),
      },
      deps(),
    );
    expect(ok.size).toBe(4);
  });

  it("0 octet restant : tout est refusé ; pas de quota : tout passe", async () => {
    await expect(
      importFromBytes(
        {
          name: "a.mp3",
          bytes: Buffer.alloc(1),
          sourceKind: null,
          prediction: null,
          owner: owner({ quota: { limit: 10, used: 10 } }),
        },
        deps(),
      ),
    ).rejects.toMatchObject(REFUSED);
    const free = await importFromBytes(
      {
        name: "a.mp3",
        bytes: Buffer.alloc(50),
        sourceKind: null,
        prediction: null,
        owner: owner({ quota: null }),
      },
      deps(),
    );
    expect(free.size).toBe(50);
  });
});
