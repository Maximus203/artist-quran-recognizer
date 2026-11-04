import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ImportError,
  importFromBytes,
  type ImportDeps,
  type ImportOwner,
} from "./import-session";
import type { NewMeta } from "./session-index";
import { sessionDir } from "./store";

/**
 * Un résultat `aqr.recognition/1` joint à l'import est relu dans le corpus avant d'être conservé :
 * l'arabe vient TOUJOURS du corpus (I1), la traduction QuranEnc ne change jamais (I2). Le contrôle
 * lui-même est une dépendance (`verifyResult`) ; ici on prouve ce que l'import en fait.
 */
let tmp: string;
const claimed: NewMeta[] = [];
const released: string[] = [];
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-import-verify-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
  claimed.length = 0;
  released.length = 0;
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

const deps = (over: Partial<ImportDeps> = {}): ImportDeps => ({
  probe: async () => ({ duration_s: 12.5, probed: true }),
  sniff: async () => ({ ok: true, family: "mp3" }),
  freeBytes: async () => null,
  prepareListening: () => undefined,
  claim: (meta) => void claimed.push(meta),
  release: (id) => void released.push(id),
  verifyResult: async () => ({ status: "ok" }),
  ...over,
});
const sessionIds = () => readdir(path.join(tmp, "sessions")).catch(() => []);
const audio = Buffer.from("audio");
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const FORGED = "نص مزيف لا يوجد في القرآن";

const recognition = (intervals: unknown[] = [], hash = sha(audio)) =>
  Buffer.from(
    JSON.stringify({
      schema: "aqr.recognition/1",
      source: { file: "a.mp3", sha256: hash, duration_s: 12.5 },
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
      intervals,
    }),
  );
const verse = (text: string) => ({
  kind: "verse",
  ref: "112:1",
  words: [1, 4],
  partial: false,
  status: "recognized",
  t: [0, 3],
  time_interpolated: false,
  confidence: 0.9,
  candidates: [],
  repetition: false,
  text,
  translation: null,
});
const owner: ImportOwner = {
  ownerId: 7,
  visibility: "private",
  name: null,
  quota: null,
};
const attempt = (
  prediction: Buffer | null,
  over: Partial<ImportDeps>,
  who?: ImportOwner,
) =>
  importFromBytes(
    {
      name: "a.mp3",
      bytes: audio,
      sourceKind: null,
      prediction,
      owner: who,
    },
    deps(over),
  );

describe("import d'un résultat — contrôle du corpus", () => {
  it("un faux texte arabe est refusé (422), rien n'est conservé, le propriétaire est libéré", async () => {
    const seen: string[] = [];
    const error = await attempt(
      recognition([verse(FORGED)]),
      {
        verifyResult: async (file) => {
          seen.push(file);
          return {
            status: "invalid",
            findings: [
              {
                index: 0,
                ref: "112:1",
                field: "text",
                message: "Le texte arabe ne correspond pas au Mushaf.",
              },
            ],
            total: 1,
          };
        },
      },
      owner,
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error.status).toBe(422);
    expect(error.message).toMatch(/contredit le corpus/);
    expect(error.message).toMatch(/intervalle 1 \(112:1\)/);
    expect(error.message).not.toContain(FORGED);
    expect(await sessionIds()).toEqual([]);
    expect(claimed).toEqual([]); // le contrôle précède l'inscription du propriétaire
    expect(seen.map((f) => path.basename(f))).toEqual([
      "prediction.recognition.json",
    ]);
  });
  it("traduction invérifiable : 503, rien n'est importé", async () => {
    const error = await attempt(recognition([verse("x")]), {
      verifyResult: async () => ({
        status: "unverifiable",
        findings: [
          {
            index: 0,
            ref: "112:1",
            field: "translation",
            message: "Traduction non vérifiée : QuranEnc est injoignable.",
          },
        ],
        total: 1,
      }),
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error.status).toBe(503);
    expect(await sessionIds()).toEqual([]);
  });
  it("contrôle indisponible : 503, un résultat n'est jamais accepté sans contrôle", async () => {
    const error = await attempt(recognition(), {
      verifyResult: async () => ({ status: "unavailable", reason: "moteur" }),
    }).catch((e) => e);
    expect(error.status).toBe(503);
    expect(await sessionIds()).toEqual([]);
  });
  it("un contrôle qui plante : refus propre en français, sans la trace interne", async () => {
    const error = await attempt(recognition(), {
      verifyResult: async () => {
        throw new Error("boom interne");
      },
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error.status).toBe(503);
    expect(error.message).not.toMatch(/boom/);
    expect(await sessionIds()).toEqual([]);
  });
  it("un résultat fidèle est importé, le fichier conservé est celui reçu à l'octet près", async () => {
    const prediction = recognition([verse("texte du corpus")]);
    const session = await attempt(prediction, {}, owner);
    expect(session.state).toBe("done");
    const kept = await readFile(
      path.join(sessionDir(session.id), "prediction.recognition.json"),
    );
    expect(kept.equals(prediction)).toBe(true);
    expect(claimed).toHaveLength(1);
  });
  it("sans résultat joint, aucun contrôle n'est lancé", async () => {
    let calls = 0;
    const session = await attempt(null, {
      verifyResult: async () => {
        calls += 1;
        return { status: "ok" };
      },
    });
    expect(session.state).toBe("ready");
    expect(calls).toBe(0);
  });
  it("un JSON invalide ou le résultat d'un autre audio sont refusés AVANT le contrôle", async () => {
    let calls = 0;
    const count: Partial<ImportDeps> = {
      verifyResult: async () => {
        calls += 1;
        return { status: "ok" };
      },
    };
    await attempt(Buffer.from("{ pas du json"), count).catch(() => undefined);
    await attempt(recognition([], "b".repeat(64)), count).catch(
      () => undefined,
    );
    expect(calls).toBe(0);
  });
});
