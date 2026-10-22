import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ImportError,
  importFromBytes,
  importFromStream,
  parseUploadName,
  sanitizeName,
  uploadLimitFor,
  type ImportDeps,
} from "./import-session";
import { MediaRejected } from "./media-probe";
import { readSession, sessionDir } from "./store";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-import-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

const prepared: string[] = [];
const deps = (over: Partial<ImportDeps> = {}): ImportDeps => ({
  probe: async () => ({ duration_s: 321.5, probed: true }),
  prepareListening: (dir) => void prepared.push(dir),
  ...over,
});
function streamOf(...chunks: Buffer[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(new Uint8Array(chunks[i++]));
      else controller.close();
    },
  });
}
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const sessionIds = async () =>
  readdir(path.join(tmp, "sessions")).catch(() => []);

describe("parseUploadName", () => {
  it("décode l'en-tête, retire tout chemin, garde l'extension en minuscules", () => {
    expect(parseUploadName(encodeURIComponent("récitation 1.MP4"))).toEqual({
      name: "récitation 1.MP4",
      extension: ".mp4",
    });
    expect(parseUploadName("..%2F..%2Fsecret.mp3").name).toBe("secret.mp3");
    expect(parseUploadName("C%3A%5Cdos%5Ca.wav").name).toBe("a.wav");
  });
  it("refuse un nom absent, mal encodé ou sans extension reconnue", () => {
    for (const bad of [
      null,
      "",
      "%E0%A4%A",
      "notes.txt",
      "sans-extension",
      ".mp3.exe",
    ])
      expect(() => parseUploadName(bad)).toThrow(ImportError);
  });
  it("un nom trop long est tronqué à 255 caractères en gardant son extension", () => {
    const parsed = parseUploadName(
      encodeURIComponent(`${"a".repeat(300)}.MP3`),
    );
    expect(parsed.name).toHaveLength(255);
    expect(parsed.name.endsWith(".MP3")).toBe(true);
    expect(parsed.extension).toBe(".mp3");
  });
  it("un nom réduit à l'extension ou à des espaces est refusé avec un message précis", () => {
    for (const bad of [".mp3", "   .mp3", " \t .mkv"]) {
      const error = (() => {
        try {
          sanitizeName(bad);
        } catch (e) {
          return e as ImportError;
        }
      })();
      expect(error).toBeInstanceOf(ImportError);
      expect(error?.status).toBe(400);
      expect(error?.message).toMatch(/nom du fichier est vide/);
    }
  });
  it("l'extension inconnue garde son message de format", () => {
    expect(() => sanitizeName("a.txt")).toThrow(/Format non accepté/);
  });
  it("retire les espaces autour du nom et les caractères de contrôle", () => {
    expect(sanitizeName("  cours\u0007 un .mp3 ").name).toBe("cours un.mp3");
  });
});

describe("uploadLimitFor", () => {
  it("audio : AQR_MAX_UPLOAD_BYTES ; vidéo : AQR_MAX_VIDEO_UPLOAD_BYTES (2 Gio par défaut)", () => {
    vi.stubEnv("AQR_MAX_UPLOAD_BYTES", "1000");
    vi.stubEnv("AQR_MAX_VIDEO_UPLOAD_BYTES", "5000");
    expect(uploadLimitFor(".mp3")).toBe(1000);
    expect(uploadLimitFor(".webm")).toBe(1000);
    expect(uploadLimitFor(".mp4")).toBe(5000);
    vi.stubEnv("AQR_MAX_VIDEO_UPLOAD_BYTES", "");
    expect(uploadLimitFor(".mkv")).toBe(2 * 1024 ** 3);
  });
});

describe("importFromStream — fichier envoyé en flux, jamais lu en mémoire", () => {
  it("écrit, calcule l'empreinte et crée une session prête, non lue, avec la durée sondée", async () => {
    const a = Buffer.from("debut-"),
      b = Buffer.from("fin");
    const session = await importFromStream(
      {
        stream: streamOf(a, b),
        filename: encodeURIComponent("cours.mp4"),
        sourceKind: null,
        contentLength: String(a.length + b.length),
      },
      deps(),
    );
    expect(session.state).toBe("ready");
    expect(session.name).toBe("cours.mp4");
    expect(session.extension).toBe(".mp4");
    expect(session.audio_sha256).toBe(sha(Buffer.concat([a, b])));
    expect(session.size).toBe(9);
    expect(session.audio_duration_s).toBe(321.5);
    expect(session.viewed_at).toBeNull();
    expect(session.source_kind).toBe("file");
    const stored = await readFile(
      path.join(sessionDir(session.id), "source.mp4"),
    );
    expect(stored.equals(Buffer.concat([a, b]))).toBe(true);
    expect((await readSession(session.id)).audio_duration_s).toBe(321.5);
    expect(prepared).toContain(sessionDir(session.id)); // copie d'écoute lancée
  });

  it("dépasse le plafond : 413, aucun dossier ni fichier laissé", async () => {
    vi.stubEnv("AQR_MAX_UPLOAD_BYTES", "10");
    const error = await importFromStream(
      {
        stream: streamOf(Buffer.alloc(8), Buffer.alloc(8)),
        filename: "a.mp3",
        sourceKind: null,
        contentLength: null,
      },
      deps(),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error.status).toBe(413);
    expect(await sessionIds()).toEqual([]);
  });

  it("Content-Length déclaré trop grand : refus avant d'écrire quoi que ce soit", async () => {
    vi.stubEnv("AQR_MAX_VIDEO_UPLOAD_BYTES", "1000");
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true;
        controller.close();
      },
    });
    const error = await importFromStream(
      { stream, filename: "a.mp4", sourceKind: null, contentLength: "999999" },
      deps(),
    ).catch((e) => e);
    expect(error.status).toBe(413);
    expect(pulled).toBe(false);
    expect(await sessionIds()).toEqual([]);
  });

  it("la même taille passe en vidéo mais pas en audio (plafonds distincts)", async () => {
    vi.stubEnv("AQR_MAX_UPLOAD_BYTES", "10");
    vi.stubEnv("AQR_MAX_VIDEO_UPLOAD_BYTES", "100");
    const body = Buffer.alloc(50, 1);
    await expect(
      importFromStream(
        {
          stream: streamOf(body),
          filename: "a.mp3",
          sourceKind: null,
          contentLength: "50",
        },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 413 });
    const ok = await importFromStream(
      {
        stream: streamOf(body),
        filename: "a.mp4",
        sourceKind: null,
        contentLength: "50",
      },
      deps(),
    );
    expect(ok.size).toBe(50);
  });

  it("fichier vide : 400, rien conservé", async () => {
    const error = await importFromStream(
      {
        stream: streamOf(),
        filename: "a.mp3",
        sourceKind: null,
        contentLength: "0",
      },
      deps(),
    ).catch((e) => e);
    expect(error.status).toBe(400);
    expect(await sessionIds()).toEqual([]);
  });

  it("vidéo sans piste audio : 422 avec le message, rien conservé", async () => {
    const error = await importFromStream(
      {
        stream: streamOf(Buffer.from("muet")),
        filename: "a.mp4",
        sourceKind: null,
        contentLength: "4",
      },
      deps({
        probe: async () => {
          throw new MediaRejected(
            "Cette vidéo ne contient aucune piste audio : il n'y a rien à analyser.",
          );
        },
      }),
    ).catch((e) => e);
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/aucune piste audio/);
    expect(await sessionIds()).toEqual([]);
  });

  it("flux interrompu en cours d'envoi : nettoyé, jamais une session à moitié écrite", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(4));
        controller.error(new Error("connexion coupée"));
      },
    });
    const error = await importFromStream(
      { stream, filename: "a.mp3", sourceKind: null, contentLength: null },
      deps(),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error.status).toBe(400);
    expect(await sessionIds()).toEqual([]);
  });

  it("origine micro acceptée ; origine inconnue refusée", async () => {
    const mic = await importFromStream(
      {
        stream: streamOf(Buffer.from("x")),
        filename: "r.webm",
        sourceKind: "microphone",
        contentLength: "1",
      },
      deps(),
    );
    expect(mic.source_kind).toBe("microphone");
    await expect(
      importFromStream(
        {
          stream: streamOf(Buffer.from("x")),
          filename: "r.webm",
          sourceKind: "satellite",
          contentLength: "1",
        },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("sans durée sondée (ffprobe absent), la session est créée sans durée — jamais inventée", async () => {
    const session = await importFromStream(
      {
        stream: streamOf(Buffer.from("x")),
        filename: "a.mp3",
        sourceKind: null,
        contentLength: "1",
      },
      deps({ probe: async () => ({ duration_s: null, probed: false }) }),
    );
    expect(session.audio_duration_s).toBeNull();
  });
});

describe("importFromBytes — formulaire multipart (audio, avec résultat facultatif)", () => {
  it("crée une session prête, non lue", async () => {
    const bytes = Buffer.from("audio");
    const session = await importFromBytes(
      { name: "a.mp3", bytes, sourceKind: null, prediction: null },
      deps(),
    );
    expect(session.state).toBe("ready");
    expect(session.audio_sha256).toBe(sha(bytes));
    expect(session.audio_duration_s).toBe(321.5);
    expect(existsSync(path.join(sessionDir(session.id), "source.mp3"))).toBe(
      true,
    );
  });
  it("avec un résultat importé : done, déjà vu (l'utilisateur le regarde), durée du résultat", async () => {
    const bytes = Buffer.from("audio");
    const prediction = Buffer.from(
      JSON.stringify({
        schema: "aqr.recognition/1",
        source: { file: "a.mp3", sha256: sha(bytes), duration_s: 12.5 },
        engine: {
          asr: "whisper-base-quran@5c",
          segmenter: "s",
          matcher: "m",
          decoder: "d",
          constrained: false,
          corpus: "c",
        },
        decoder: {},
        timing: {},
        windows: 1,
        warnings: [],
        intervals: [],
      }),
    );
    const session = await importFromBytes(
      { name: "a.mp3", bytes, sourceKind: null, prediction },
      deps(),
    );
    expect(session.state).toBe("done");
    expect(session.viewed_at).toEqual(expect.any(String));
    expect(session.audio_duration_s).toBe(12.5);
    expect(session.engine).toBe("whisper");
    expect(session.duration_s ?? null).toBeNull(); // pas de durée de traitement inventée
  });
  it("résultat joint illisible ou d'un autre format : message en français, sans trace de l'analyseur", async () => {
    for (const bad of ["{ pas du json", JSON.stringify({ hello: "monde" })]) {
      const error = await importFromBytes(
        {
          name: "a.mp3",
          bytes: Buffer.from("audio"),
          sourceKind: null,
          prediction: Buffer.from(bad),
        },
        deps(),
      ).catch((e) => e);
      expect(error).toBeInstanceOf(ImportError);
      expect(error.status).toBe(400);
      expect(error.message).toMatch(/résultat joint/);
      expect(error.message).not.toMatch(/Expected|expected|received|\[\s*\{/);
      expect(error.message.length).toBeLessThan(200);
    }
    expect(await sessionIds()).toEqual([]);
  });
  it("résultat d'un autre audio : 400, rien conservé", async () => {
    const prediction = Buffer.from(
      JSON.stringify({
        schema: "aqr.recognition/1",
        source: { file: "a.mp3", sha256: "b".repeat(64), duration_s: 12.5 },
        engine: {
          asr: "w",
          segmenter: "s",
          matcher: "m",
          decoder: "d",
          constrained: false,
          corpus: "c",
        },
        decoder: {},
        timing: {},
        windows: 1,
        warnings: [],
        intervals: [],
      }),
    );
    await expect(
      importFromBytes(
        {
          name: "a.mp3",
          bytes: Buffer.from("audio"),
          sourceKind: null,
          prediction,
        },
        deps(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(await sessionIds()).toEqual([]);
  });
  it("vidéo sans audio en multipart : 422, rien conservé", async () => {
    await expect(
      importFromBytes(
        {
          name: "a.mkv",
          bytes: Buffer.from("x"),
          sourceKind: null,
          prediction: null,
        },
        deps({
          probe: async () => {
            throw new MediaRejected(
              "Cette vidéo ne contient aucune piste audio",
            );
          },
        }),
      ),
    ).rejects.toMatchObject({ status: 422 });
    expect(await sessionIds()).toEqual([]);
  });
});
