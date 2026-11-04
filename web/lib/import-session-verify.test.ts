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
import { log } from "./log";
import type { NewMeta } from "./session-index";
import { sessionDir } from "./store";

// Le journal est la seule porte de sortie : on regarde ce qu'on lui confie, sans rien écrire.
vi.mock("./log", async (original) => {
  const actual = await original<typeof import("./log")>();
  return { ...actual, log: { ...actual.log, event: vi.fn() } };
});

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

describe("import d'un résultat — fichiers que l'analyseur ne sait pas lire (N7)", () => {
  const BOM = Buffer.from([0xef, 0xbb, 0xbf]);
  it("un BOM UTF-8 est accepté : le fichier conservé est le même, sans ses trois octets", async () => {
    const prediction = recognition([verse("texte du corpus")]);
    const seen: string[] = [];
    const session = await attempt(Buffer.concat([BOM, prediction]), {
      verifyResult: async (file) => {
        seen.push((await readFile(file)).toString("utf8").slice(0, 1));
        return { status: "ok" };
      },
    });
    expect(session.state).toBe("done");
    expect(seen).toEqual(["{"]); // le contrôle lit le fichier sans BOM
    const kept = await readFile(
      path.join(sessionDir(session.id), "prediction.recognition.json"),
    );
    expect(kept.equals(prediction)).toBe(true);
    expect(session.prediction_sha256).toBe(sha(prediction));
  });
  it("un fichier UTF-16 est refusé en 400 avec la marche à suivre, avant tout contrôle", async () => {
    let calls = 0;
    const error = await attempt(
      Buffer.concat([
        Buffer.from([0xff, 0xfe]),
        Buffer.from("{\0}\0", "binary"),
      ]),
      {
        verifyResult: async () => {
          calls += 1;
          return { status: "ok" };
        },
      },
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ImportError);
    expect(error.status).toBe(400);
    expect(error.code).toBe("result_encoding");
    expect(error.message).toMatch(/UTF-8/);
    expect(calls).toBe(0);
    expect(await sessionIds()).toEqual([]);
  });
  it("un JSON de 20 000 niveaux est un 422 « trop imbriqué », jamais un 503 « indisponible »", async () => {
    let calls = 0;
    const deep = Buffer.from(`{"x":${"[".repeat(20000)}${"]".repeat(20000)}}`);
    const error = await attempt(deep, {
      verifyResult: async () => {
        calls += 1;
        return { status: "ok" };
      },
    }).catch((e) => e);
    expect(error.status).toBe(422);
    expect(error.code).toBe("result_too_deep");
    expect(error.message).not.toMatch(/indisponible/);
    expect(calls).toBe(0);
    expect(await sessionIds()).toEqual([]);
  });
});

describe("import d'un résultat — les refus sont journalisés (N10)", () => {
  const events = () =>
    vi
      .mocked(log.event)
      .mock.calls.filter(([, name]) => name === "import.result_refused");
  beforeEach(() => vi.mocked(log.event).mockClear());

  it("un résultat qui contredit le corpus : rang, verset, champ, code ; jamais le faux texte", async () => {
    await attempt(
      recognition([verse(FORGED)]),
      {
        verifyResult: async () => ({
          status: "invalid",
          findings: [
            {
              index: 0,
              ref: "112:1",
              field: "text",
              message: `Le texte ${FORGED} ne correspond pas`,
            },
          ],
          total: 1,
        }),
      },
      owner,
    ).catch(() => undefined);
    expect(events()).toHaveLength(1);
    const [scope, name, fields, level] = events()[0];
    expect(scope).toBe("import");
    expect(name).toBe("import.result_refused");
    expect(level).toBe("warn");
    expect(fields).toMatchObject({
      code: "result_contradicts_corpus",
      http: 422,
      owner: 7,
      verdict: "invalid",
      rank: 1,
      ref: "112:1",
      field: "text",
      total: 1,
    });
    expect(JSON.stringify(fields)).not.toContain(FORGED);
  });
  it("le contrôle indisponible est une erreur (la panne qu'on doit voir), avec sa raison", async () => {
    await attempt(recognition(), {
      verifyResult: async () => ({
        status: "unavailable",
        reason: "ERREUR LOCK.json introuvable",
      }),
    }).catch(() => undefined);
    const [, , fields, level] = events()[0];
    expect(level).toBe("error");
    expect(fields).toMatchObject({
      code: "result_check_unavailable",
      http: 503,
      verdict: "unavailable",
      reason: "ERREUR LOCK.json introuvable",
      owner: null,
    });
  });
  it("un contrôle qui plante est journalisé comme indisponible, sans la trace", async () => {
    await attempt(recognition(), {
      verifyResult: async () => {
        throw new Error("boom interne");
      },
    }).catch(() => undefined);
    const [, , fields, level] = events()[0];
    expect(level).toBe("error");
    expect(fields).toMatchObject({ verdict: "unavailable" });
    expect(JSON.stringify(fields)).not.toMatch(/boom/);
  });
  it("une traduction invérifiable : avertissement avec la cause", async () => {
    await attempt(recognition([verse("x")]), {
      verifyResult: async () => ({
        status: "unverifiable",
        findings: [
          {
            index: 0,
            ref: "112:1",
            field: "translation",
            message: "x",
            cause: "offline",
          },
        ],
        total: 1,
      }),
    }).catch(() => undefined);
    const [, , fields, level] = events()[0];
    expect(level).toBe("warn");
    expect(fields).toMatchObject({
      code: "result_unverifiable",
      http: 503,
      cause: "offline",
    });
  });
  it("les refus d'avant le contrôle (JSON, empreinte, encodage, imbrication) le sont aussi", async () => {
    const none: Partial<ImportDeps> = {};
    await attempt(Buffer.from("{ pas du json"), none).catch(() => undefined);
    await attempt(recognition([], "b".repeat(64)), none).catch(() => undefined);
    await attempt(Buffer.from([0xff, 0xfe, 0x7b, 0x00]), none).catch(
      () => undefined,
    );
    await attempt(Buffer.from("[".repeat(100) + "]".repeat(100)), none).catch(
      () => undefined,
    );
    expect(
      events().map(([, , fields]) => (fields as { code: string }).code),
    ).toEqual(["invalid", "invalid", "result_encoding", "result_too_deep"]);
  });
  it("un import qui réussit ne journalise aucun refus", async () => {
    await attempt(recognition([verse("texte du corpus")]), {});
    expect(events()).toEqual([]);
  });
});
