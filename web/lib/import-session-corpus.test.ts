import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { importFromBytes, type ImportDeps } from "./import-session";
import { pythonCommand } from "./python";
import { verifyResultFile } from "./result-check";
import { REPO } from "./store";

/**
 * Bout en bout, sans simulation du contrôle : le vrai `aqr verify-recognition`, le vrai corpus.
 * Saute (au lieu d'échouer) si le corpus n'est pas téléchargé ou si le moteur Python n'est pas
 * installé, comme les tests Python du même contrôle. Aucune traduction n'est lue ici (pas de réseau).
 */
const corpusDir =
  process.env.AQR_CORPUS_DIR || path.join(REPO, "data", "corpus");
const { python, env } = pythonCommand();
const corpusPresent = existsSync(path.join(corpusDir, "quran-uthmani.txt"));
const engine = corpusPresent
  ? spawnSync(
      python,
      [
        "-c",
        "import sys;from pathlib import Path;from aqr.corpus.tanzil_repository import TanzilCorpusRepository as R;from aqr.domain.models import VerseRef as V;sys.stdout.buffer.write(R(Path(sys.argv[1])).text(V(112,1)).encode('utf-8'))",
        corpusDir,
      ],
      { env, cwd: REPO, encoding: "buffer" },
    )
  : null;
const VERSE_112_1 = engine?.status === 0 ? engine.stdout.toString("utf8") : "";
const ready = VERSE_112_1.length > 0;

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-import-corpus-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

const audio = Buffer.from("audio");
const deps: ImportDeps = {
  probe: async () => ({ duration_s: 12.5, probed: true }),
  sniff: async () => ({ ok: true, family: "mp3" }),
  freeBytes: async () => null,
  prepareListening: () => undefined,
  claim: () => undefined,
  release: () => undefined,
  verifyResult: (file) => verifyResultFile(file),
};
const interval = (over: object) => ({
  kind: "verse",
  ref: "112:1",
  words: [1, 8],
  partial: false,
  status: "recognized",
  t: [0, 3],
  time_interpolated: false,
  confidence: 0.9,
  candidates: [],
  repetition: false,
  text: null,
  translation: null,
  ...over,
});
const result = (...intervals: object[]) =>
  Buffer.from(
    JSON.stringify({
      schema: "aqr.recognition/1",
      source: {
        file: "a.mp3",
        sha256: createHash("sha256").update(audio).digest("hex"),
        duration_s: 12.5,
      },
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
const attempt = (prediction: Buffer) =>
  importFromBytes(
    { name: "a.mp3", bytes: audio, sourceKind: null, prediction },
    deps,
  );
const sessionIds = () => readdir(path.join(tmp, "sessions")).catch(() => []);

describe.skipIf(!ready)(
  "import d'un résultat — vrai contrôle du corpus",
  () => {
    it("le texte arabe du corpus est accepté", async () => {
      const session = await attempt(result(interval({ text: VERSE_112_1 })));
      expect(session.state).toBe("done");
    });
    it("une copie expurgée (sans texte) est acceptée", async () => {
      expect((await attempt(result(interval({})))).state).toBe("done");
    });
    it("scénario QA s32 : un faux texte arabe pour 112:1 est refusé, rien n'est conservé", async () => {
      const forged = "نص مزيف لا يوجد في القرآن";
      const error = await attempt(result(interval({ text: forged }))).catch(
        (e) => e,
      );
      expect(error.status).toBe(422);
      expect(error.code).toBe("result_contradicts_corpus");
      expect(error.message).toMatch(/intervalle 1 \(112:1\)/);
      expect(error.message).not.toContain(forged);
      expect(await sessionIds()).toEqual([]);
    });
    it("un verset qui n'existe pas (112:9) est refusé", async () => {
      const error = await attempt(result(interval({ ref: "112:9" }))).catch(
        (e) => e,
      );
      expect(error.status).toBe(422);
      expect(await sessionIds()).toEqual([]);
    });
    it("une traduction d'un identifiant inconnu est refusée sans réseau", async () => {
      const error = await attempt(
        result(
          interval({
            text: VERSE_112_1,
            translation: {
              text: "Traduction ALTÉRÉE par l'import",
              translation_id: "french_inventee",
              version: "x",
              attribution: "y",
              scope: "verse",
            },
          }),
        ),
      ).catch((e) => e);
      expect(error.status).toBe(422);
      expect(await sessionIds()).toEqual([]);
    });
  },
);
