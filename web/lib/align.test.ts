import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  alignValidation,
  proposeValidation,
  readValidation,
  writeManifest,
} from "./align";
import type { PythonRunner } from "./python";
import { saveSession, sessionDir, type Session } from "./store";
import { editPassage } from "./validation";

const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const SHA = "a".repeat(64);
let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-align-"));
  vi.stubEnv("AQR_REVIEW_DIR", path.join(tmp, "review"));
  vi.stubEnv("AQR_MODELS_DIR", path.join(tmp, "models"));
  vi.stubEnv("AQR_MANIFEST", path.join(tmp, "manifest.yaml"));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

async function seed(state: Session["state"] = "done"): Promise<void> {
  await saveSession({
    id: ID,
    name: "lot1-06.mp3",
    extension: ".mp3",
    audio_sha256: SHA,
    size: 4,
    created_at: "2026-10-19T00:00:00.000Z",
    state,
    error: null,
    started_at: null,
    finished_at: null,
    prediction_sha256: "b".repeat(64),
    pid: null,
  });
  await writeFile(path.join(sessionDir(ID), "source.mp3"), "fake");
}

const PLAN = {
  schema: "aqr.align-plan/1",
  source: { sha256: SHA, duration_s: 200 },
  passages: [
    { t: [46.1, 84.8], verses: "21:51-21:54" },
    { t: [90, 106], verses: "21:56" },
  ],
};

/** Faux moteur : imite plan-alignment, align --plan et data import-alignment. */
function engine(
  calls: string[][],
  options: { failAlign?: boolean } = {},
): PythonRunner {
  return async (args) => {
    calls.push(args);
    if (args[0] === "plan-alignment")
      return { code: 0, stdout: JSON.stringify(PLAN), stderr: "" };
    if (args[0] === "align") {
      if (options.failAlign)
        return {
          code: 2,
          stdout: "",
          stderr: "[NeMo] bruit\nERREUR modèle introuvable\n",
        };
      const plan = JSON.parse(
        await readFile(args[args.indexOf("--plan") + 1], "utf8"),
      );
      const out = args[args.indexOf("--out-dir") + 1];
      await writeFile(
        path.join(out, "source.alignment.json"),
        JSON.stringify({
          schema: "aqr.alignment/2",
          source: { sha256: SHA },
          engine: {
            model: "fastconformer-quran@b33af7936f9a/ctc",
            corpus: "tanzil",
          },
          config: { energy_ratio: 0.1 },
          passages: plan.passages.map(
            (p: { t: [number, number]; verses: string }) => ({
              declared: p.verses,
              t: p.t,
              variant: "simple",
              evidence: {
                llr_per_frame: -0.2,
                forced_logprob: -3,
                free_logprob: -1,
                frames: 30,
              },
              spans: [
                {
                  ref: "21:51",
                  kind: "verse",
                  words: [1, 9],
                  partial: false,
                  t: [p.t[0] + 1, p.t[1] - 1],
                  word_times: [],
                },
              ],
            }),
          ),
        }),
      );
      return { code: 0, stdout: "écrit", stderr: "" };
    }
    if (args[0] === "data")
      return {
        code: 0,
        stdout: "lot1-06 : 1 verset(s) de vérité terrain · écrit : m\n",
        stderr: "",
      };
    return { code: 1, stdout: "", stderr: "ERREUR commande inconnue" };
  };
}

describe("validation dans l'atelier", () => {
  it("propose, aligne puis écrit les seuls passages validés", async () => {
    await seed();
    const calls: string[][] = [];
    const run = engine(calls);
    const proposed = await proposeValidation(ID, run);
    expect(calls[0][1]).toContain("prediction.recognition.json");
    const ids = proposed.passages.map((p) => p.id);
    const aligned = await alignValidation(ID, ids, run);
    const align = calls[1];
    expect(align.slice(0, 2)).toEqual([
      "align",
      path.join(sessionDir(ID), "source.mp3"),
    ]);
    expect(align).toContain("--models-dir");
    expect(aligned.passages.map((p) => p.status)).toEqual([
      "aligned",
      "aligned",
    ]);

    const { saveValidation } = await import("./align");
    await saveValidation(editPassage(aligned, ids[1], { status: "validated" }));
    const { report, validation } = await writeManifest(ID, "rel-01", run);
    const data = calls[2];
    expect(data.slice(0, 4)).toEqual([
      "data",
      "--manifest",
      path.join(tmp, "manifest.yaml"),
      "import-alignment",
    ]);
    expect(data).toContain("rel-01");
    const written = JSON.parse(await readFile(data[4], "utf8"));
    expect(
      written.passages.map((p: { declared: string }) => p.declared),
    ).toEqual(["21:56"]);
    expect(report).toContain("lot1-06");
    expect(validation.written).toHaveLength(1);
  });

  it("refuse de proposer sans reconnaissance terminée", async () => {
    await seed("ready");
    await expect(proposeValidation(ID, engine([]))).rejects.toThrow(
      "reconnaissance",
    );
  });

  it("rapporte l'erreur du moteur, pas son bruit", async () => {
    await seed();
    const calls: string[][] = [];
    const proposed = await proposeValidation(ID, engine(calls));
    await expect(
      alignValidation(
        ID,
        [proposed.passages[0].id],
        engine(calls, { failAlign: true }),
      ),
    ).rejects.toThrow("ERREUR modèle introuvable");
    expect((await readValidation(ID)).passages[0].status).toBe("proposed");
  });

  it("une déclaration modifiée pendant le calcul n'est pas écrasée", async () => {
    await seed();
    const calls: string[][] = [];
    const base = engine(calls);
    const proposed = await proposeValidation(ID, base);
    const [first] = proposed.passages;
    const { saveValidation } = await import("./align");
    const racing: PythonRunner = async (args) => {
      const result = await base(args);
      await saveValidation(
        editPassage(await readValidation(ID), first.id, {
          verses: "21:51-21:53",
        }),
      );
      return result;
    };
    const after = await alignValidation(ID, [first.id], racing);
    expect(after.passages[0].verses).toBe("21:51-21:53");
    expect(after.passages[0].status).toBe("proposed");
  });

  it("sans modèles configurés, aucun lancement", async () => {
    await seed();
    vi.stubEnv("AQR_MODELS_DIR", "");
    const calls: string[][] = [];
    const proposed = await proposeValidation(ID, engine(calls));
    await expect(
      alignValidation(ID, [proposed.passages[0].id], engine(calls)),
    ).rejects.toThrow("AQR_MODELS_DIR");
    expect(calls).toHaveLength(1);
  });
});
