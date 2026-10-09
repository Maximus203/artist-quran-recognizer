import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cancel, jobSettled, launch } from "./jobs";
import { readSession, saveSession, sessionDir, type Session } from "./store";

// Faux interpréteur Python : un script node exécutable qui imite `aqr recognize`.
const FAKE = `#!/usr/bin/env node
const fs = require("fs"), crypto = require("crypto"), path = require("path");
const a = process.argv.slice(2);
const source = a[3], out = a[a.indexOf("--out-dir") + 1];
const mode = process.env.FAKE_MODE || "ok";
fs.writeFileSync(path.join(out, "args.json"), JSON.stringify(a));
if (mode === "linger") {
  // Le processus meurt, mais un petit-enfant garde stdout/stderr ouverts : « exit » précède « close » d'~1 s.
  require("child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 1000)"],
    { stdio: ["ignore", "inherit", "inherit"], detached: true }).unref();
  console.error("boom: modèle introuvable"); process.exit(3);
}
if (mode === "fail") { console.error("boom: modèle introuvable"); process.exit(3); }
if (mode === "sleep") { setTimeout(() => {}, 60000); }
else {
  const hash = mode === "badhash" ? "b".repeat(64)
    : crypto.createHash("sha256").update(fs.readFileSync(source)).digest("hex");
  fs.writeFileSync(path.join(out, "source.recognition.json"), JSON.stringify({
    schema: "aqr.recognition/1",
    source: { file: "source.mp3", sha256: hash, duration_s: 5 },
    engine: { asr: "w", segmenter: "s", matcher: "m", decoder: "d", constrained: false, corpus: "c" },
    decoder: {}, timing: {}, windows: 1, warnings: [], intervals: [],
  }));
}
`;
const BYTES = Buffer.from("fake-audio");
const HASH = "a".repeat(64);
const ID = "0f0e0d0c-0b0a-4908-8706-050403020100";

let tmp: string;
let fake: string;
beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-jobs-"));
  fake = path.join(tmp, "fake-python.cjs");
  await writeFile(fake, FAKE);
  await chmod(fake, 0o755);
  vi.stubEnv("AQR_REVIEW_DIR", path.join(tmp, "review"));
  vi.stubEnv("AQR_PYTHON", fake);
  vi.stubEnv("AQR_MODELS_DIR", path.join(tmp, "models"));
});
afterEach(async () => {
  // Aucun gestionnaire `close` ne doit survivre au test (écritures dans un dossier supprimé
  // ou dans la session du test suivant, qui partage le même identifiant).
  await jobSettled(ID);
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

async function seed(over: Partial<Session> = {}, hash = HASH): Promise<void> {
  const { createHash } = await import("node:crypto");
  const real = createHash("sha256").update(BYTES).digest("hex");
  await saveSession({
    id: ID,
    name: "a.mp3",
    extension: ".mp3",
    audio_sha256: hash === HASH ? real : hash,
    size: BYTES.length,
    source_kind: "file",
    created_at: "2026-10-01T00:00:00.000Z",
    state: "ready",
    error: null,
    started_at: null,
    finished_at: null,
    prediction_sha256: null,
    pid: null,
    ...over,
  });
  await writeFile(path.join(sessionDir(ID), "source.mp3"), BYTES);
}
/** Attend que le gestionnaire `close` ait consigné l'issue, sans sonder la session. */
async function settle(): Promise<Session> {
  await jobSettled(ID);
  return readSession(ID);
}

describe("lancement du moteur", () => {
  it("exige AQR_MODELS_DIR", async () => {
    vi.stubEnv("AQR_MODELS_DIR", "");
    await seed();
    await expect(launch(ID)).rejects.toThrow(/AQR_MODELS_DIR/);
    expect((await readSession(ID)).state).toBe("ready");
  });
  it("refuse un identifiant invalide", async () => {
    await expect(launch("../..")).rejects.toThrow("Identifiant invalide");
  });
  it("refuse de relancer une session déjà terminée", async () => {
    await seed({ state: "done" });
    await expect(launch(ID)).rejects.toThrow(/résultat existe/);
  });
  it("refuse de relancer une session en cours", async () => {
    await seed({ state: "running", pid: process.pid });
    await expect(launch(ID)).rejects.toThrow(/déjà en cours/);
  });
  it("chemin nominal : passe en done, écrit la prédiction et ses empreintes", async () => {
    await seed();
    await launch(ID);
    const done = await settle();
    expect(done.state).toBe("done");
    expect(done.error).toBeNull();
    expect(done.prediction_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(done.pid).toBeNull();
    expect(done.finished_at).not.toBeNull();
  });
  it("transmet source, --out-dir, --asr, --models-dir au CLI, sans shell", async () => {
    await seed();
    await launch(ID);
    await settle();
    const args = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(path.join(sessionDir(ID), "args.json"), "utf8"),
    ) as string[];
    expect(args.slice(0, 3)).toEqual(["-m", "aqr.cli", "recognize"]);
    expect(args[3]).toBe(path.join(sessionDir(ID), "source.mp3"));
    expect(args[args.indexOf("--out-dir") + 1]).toBe(sessionDir(ID));
    expect(args[args.indexOf("--models-dir") + 1]).toBe(
      path.join(tmp, "models"),
    );
    expect(["fastconformer", "whisper"]).toContain(
      args[args.indexOf("--asr") + 1],
    );
  });
  it("code de sortie non nul : failed avec le dernier message du moteur", async () => {
    vi.stubEnv("FAKE_MODE", "fail");
    await seed();
    await launch(ID);
    const out = await settle();
    expect(out.state).toBe("failed");
    expect(out.error).toContain("boom: modèle introuvable");
    expect(out.pid).toBeNull();
  });
  it("hash de sortie incohérent : failed, aucune prédiction adoptée", async () => {
    vi.stubEnv("FAKE_MODE", "badhash");
    await seed();
    await launch(ID);
    const out = await settle();
    expect(out.state).toBe("failed");
    expect(out.error).toMatch(/Hash audio/);
    expect(out.prediction_sha256).toBeNull();
  });
});

describe("lecture concurrente pendant la fin du traitement", () => {
  const GENERIC = /s’est arrêté avant de produire/;
  async function untilProcessGone(pid: number): Promise<void> {
    for (let i = 0; i < 500; i++) {
      try {
        process.kill(pid, 0);
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error("le processus du faux moteur ne s'est pas arrêté");
  }
  it("un lecteur ne déclare pas failed un traitement que ce serveur n'a pas fini de consigner", async () => {
    vi.stubEnv("FAKE_MODE", "linger");
    await seed();
    await launch(ID);
    const { pid } = JSON.parse(
      await readFile(path.join(sessionDir(ID), "session.json"), "utf8"),
    ) as Session;
    expect(pid).not.toBeNull();
    await untilProcessGone(pid as number);
    // Processus mort, « close » pas encore arrivé : ni échec générique, ni écriture.
    const during = await readSession(ID);
    expect(during.state).toBe("running");
    expect(during.error ?? "").not.toMatch(GENERIC);
    const final = await settle();
    expect(final.state).toBe("failed");
    expect(final.error).toContain("boom: modèle introuvable");
    expect(final.error).not.toMatch(GENERIC);
  });
});

describe("jobSettled", () => {
  it("se résout aussitôt quand aucun traitement n'est en cours", async () => {
    await expect(jobSettled(ID)).resolves.toBeUndefined();
  });
});

describe("annulation", () => {
  it("échoue s'il n'y a aucun traitement actif dans ce serveur", async () => {
    await seed();
    await expect(cancel(ID)).rejects.toThrow(/Aucun traitement actif/);
  });
  it("tue le processus et marque la session cancelled", async () => {
    vi.stubEnv("FAKE_MODE", "sleep");
    await seed();
    await launch(ID);
    expect((await readSession(ID)).state).toBe("running");
    await cancel(ID);
    const out = await readSession(ID);
    expect(out.state).toBe("cancelled");
    expect(out.pid).toBeNull();
    // Le gestionnaire `close` ne doit pas écraser l'annulation.
    await jobSettled(ID);
    expect((await readSession(ID)).state).toBe("cancelled");
  });
});
