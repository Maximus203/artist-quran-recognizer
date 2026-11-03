import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EngineInputError,
  NotReadyError,
  UnresolvedItemsError,
  clearExportCache,
  corpusVerse,
  exportSubtitles,
  previewSubtitles,
  readiness,
} from "./export-engine";
import { DEFAULT_EXPORT_OPTIONS } from "./export-options";
import type { PythonRun, PythonRunner } from "./python";
import { saveSession, sessionDir, type Session } from "./store";

const ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let dir: string;
let previousDir: string | undefined;

async function seed(state: Session["state"] = "done") {
  await mkdir(sessionDir(ID), { recursive: true });
  await writeFile(
    path.join(sessionDir(ID), "prediction.recognition.json"),
    "{}",
    "utf8",
  );
  await saveSession({
    id: ID,
    name: "cours du soir.mp3",
    extension: ".mp3",
    audio_sha256: "c".repeat(64),
    size: 3,
    created_at: "2026-10-22T09:00:00.000Z",
    state,
    error: null,
    started_at: null,
    finished_at: null,
    prediction_sha256: "d".repeat(64),
    pid: null,
  });
}
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-export-engine-"));
  previousDir = process.env.AQR_REVIEW_DIR;
  process.env.AQR_REVIEW_DIR = dir;
  clearExportCache();
  await seed();
});
afterEach(async () => {
  if (previousDir === undefined) delete process.env.AQR_REVIEW_DIR;
  else process.env.AQR_REVIEW_DIR = previousDir;
  await rm(dir, { recursive: true, force: true });
});

const ok = (stdout: unknown): PythonRun => ({
  code: 0,
  stdout: JSON.stringify(stdout),
  stderr: "",
});
function recorder(answer: (args: string[]) => PythonRun | Promise<PythonRun>) {
  const calls: string[][] = [];
  const run: PythonRunner = async (args) => {
    calls.push(args);
    return answer(args);
  };
  return { calls, run };
}

describe("contrôle de préparation", () => {
  it("lance export-readiness avec le corpus, les options et les étiquettes bloquantes", async () => {
    const { calls, run } = recorder(() => ok({ verdict: { total: 0 } }));
    const payload = await readiness(
      ID,
      DEFAULT_EXPORT_OPTIONS,
      { page: 2, size: 5, type: "uncertain" },
      run,
    );
    expect(payload).toEqual({ verdict: { total: 0 } });
    const [args] = calls;
    expect(args[0]).toBe("export-readiness");
    expect(args).toContain("--blocking-tags");
    expect(args[args.indexOf("--blocking-tags") + 1]).toContain("wrong_verse");
    expect(args).toContain("--corpus-dir");
    expect(JSON.parse(args[args.indexOf("--options") + 1])).toEqual(
      DEFAULT_EXPORT_OPTIONS,
    );
    expect(
      args.slice(args.indexOf("--page"), args.indexOf("--page") + 2),
    ).toEqual(["--page", "2"]);
    expect(args).toContain("--type");
    expect(args).not.toContain("--decisions");
  });

  it("passe les décisions et la revue quand elles existent", async () => {
    await writeFile(path.join(sessionDir(ID), "decisions.json"), "{}", "utf8");
    await writeFile(path.join(sessionDir(ID), "review.json"), "{}", "utf8");
    const { calls, run } = recorder(() => ok({}));
    await readiness(ID, DEFAULT_EXPORT_OPTIONS, {}, run);
    expect(calls[0]).toContain("--decisions");
    expect(calls[0]).toContain("--review");
  });

  it("mémorise une réponse identique, et la refait si les décisions changent", async () => {
    const { calls, run } = recorder(() => ok({ n: calls.length }));
    await readiness(ID, DEFAULT_EXPORT_OPTIONS, {}, run);
    await readiness(ID, DEFAULT_EXPORT_OPTIONS, {}, run);
    expect(calls).toHaveLength(1);
    await readiness(ID, { ...DEFAULT_EXPORT_OPTIONS, content: "ar" }, {}, run);
    expect(calls).toHaveLength(2);
    await new Promise((r) => setTimeout(r, 15));
    await writeFile(
      path.join(sessionDir(ID), "decisions.json"),
      '{"x":1}',
      "utf8",
    );
    await readiness(ID, DEFAULT_EXPORT_OPTIONS, {}, run);
    expect(calls).toHaveLength(3);
  });

  it("deux demandes simultanées identiques partagent un seul calcul", async () => {
    const { calls, run } = recorder(async () => {
      await new Promise((r) => setTimeout(r, 20));
      return ok({});
    });
    await Promise.all([
      readiness(ID, DEFAULT_EXPORT_OPTIONS, {}, run),
      readiness(ID, DEFAULT_EXPORT_OPTIONS, {}, run),
    ]);
    expect(calls).toHaveLength(1);
  });

  it("une analyse pas terminée n'a rien à contrôler", async () => {
    await seed("running");
    const { run } = recorder(() => ok({}));
    await expect(
      readiness(ID, DEFAULT_EXPORT_OPTIONS, {}, run),
    ).rejects.toThrow(NotReadyError);
  });
});

describe("export", () => {
  it("traduit le code 3 en passages à corriger", async () => {
    const { run } = recorder(() => ({
      code: 3,
      stdout: JSON.stringify({ error: "unresolved_items", unresolved: 4 }),
      stderr: "ERREUR",
    }));
    const attempt = exportSubtitles(ID, DEFAULT_EXPORT_OPTIONS, undefined, run);
    await expect(attempt).rejects.toThrow(UnresolvedItemsError);
    await expect(attempt).rejects.toMatchObject({ unresolved: 4 });
  });

  it("le code 1 devient un message à montrer, jamais un chemin", async () => {
    const { run } = recorder(() => ({
      code: 1,
      stdout: "",
      stderr: "journal NeMo\nERREUR options : format inconnu",
    }));
    await expect(
      exportSubtitles(ID, DEFAULT_EXPORT_OPTIONS, undefined, run),
    ).rejects.toThrow(EngineInputError);
  });

  it("écrit dans le dossier d'exports de la session, lit le fichier puis le supprime", async () => {
    let written = "";
    const { run } = recorder(async (args) => {
      written = args[args.indexOf("--out") + 1];
      await mkdir(path.dirname(written), { recursive: true });
      await writeFile(
        written,
        "﻿1\n00:00:01,000 --> 00:00:02,000\nx\n",
        "utf8",
      );
      return ok({
        schema: "aqr.export-result/1",
        format: "srt",
        cues: 1,
        forced: false,
        unresolved: 0,
      });
    });
    const file = await exportSubtitles(
      ID,
      DEFAULT_EXPORT_OPTIONS,
      undefined,
      run,
    );
    expect(written.startsWith(sessionDir(ID))).toBe(true);
    expect(file.name).toBe("cours du soir.ar-fr.srt");
    expect(file.content.startsWith("﻿1\n")).toBe(true);
    expect(file.mime).toContain("subrip");
    const { stat } = await import("node:fs/promises");
    await expect(stat(written)).rejects.toThrow();
  });

  it("l'aperçu demande les N premiers sous-titres sans rien écrire", async () => {
    const { calls, run } = recorder(() => ok({ preview: { cues: [] } }));
    await previewSubtitles(ID, DEFAULT_EXPORT_OPTIONS, 3, run);
    expect(calls[0]).toContain("--preview");
    expect(calls[0]).not.toContain("--out");
  });
});

describe("lecture d'un verset", () => {
  it("valide la référence avant tout lancement", async () => {
    const { calls, run } = recorder(() => ok({ ok: true }));
    expect(await corpusVerse("pas-un-verset", null, run)).toMatchObject({
      ok: false,
    });
    expect(await corpusVerse("2:255", "../x", run)).toMatchObject({
      ok: false,
    });
    expect(calls).toHaveLength(0);
    expect(await corpusVerse("2:255", "1-5", run)).toEqual({ ok: true });
    expect(calls[0].slice(0, 2)).toEqual(["corpus-verse", "2:255"]);
  });
  it("un verset inexistant répond ok: false (code 1 du moteur), pas une panne", async () => {
    const { run } = recorder(() => ({
      code: 1,
      stdout: JSON.stringify({ ok: false, error: "Ce verset n'existe pas." }),
      stderr: "",
    }));
    expect(await corpusVerse("115:1", null, run)).toEqual({
      ok: false,
      error: "Ce verset n'existe pas.",
    });
  });
});
