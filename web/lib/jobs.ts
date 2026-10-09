import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRecognition } from "./recognition";
import {
  REPO,
  audioPath,
  jobs,
  readSession,
  saveSession,
  sessionDir,
  sha,
} from "./store";

const ASR_ENGINES = ["fastconformer", "whisper"];
/** Moteur ASR de l'atelier : FastConformer par défaut, `AQR_ASR=whisper` pour l'autre. */
export const ASR_ENGINE = ASR_ENGINES.includes(process.env.AQR_ASR ?? "")
  ? (process.env.AQR_ASR as string)
  : "fastconformer";

export async function launch(id: string): Promise<void> {
  const session = await readSession(id);
  if (session.state === "running") throw new Error("Traitement déjà en cours");
  if (session.state === "done")
    throw new Error("Un résultat existe déjà ; crée une nouvelle session.");
  const models = process.env.AQR_MODELS_DIR;
  if (!models)
    throw new Error(
      "AQR_MODELS_DIR absent : les poids du moteur ne sont pas configurés sur cette machine.",
    );
  const source = await audioPath(id),
    output = sessionDir(id);
  const python = process.env.AQR_PYTHON || "python";
  const args = [
    "-m",
    "aqr.cli",
    "recognize",
    source,
    "--out-dir",
    output,
    "--asr",
    ASR_ENGINE,
    "--format",
    "json",
    "--models-dir",
    models,
    "--corpus-dir",
    process.env.AQR_CORPUS_DIR || path.join(REPO, "data", "corpus"),
    "--lock",
    path.join(REPO, "models", "LOCK.json"),
  ];
  const child = spawn(/* turbopackIgnore: true */ python, args, {
    cwd: REPO,
    shell: false,
    windowsHide: true,
    env: { ...process.env, PYTHONPATH: path.join(REPO, "src") },
  });
  let settle!: () => void;
  const settled = new Promise<void>((resolve) => (settle = resolve));
  jobs.set(id, { child, settled });
  session.state = "running";
  session.error = null;
  session.started_at = new Date().toISOString();
  session.pid = child.pid || null;
  await saveSession(session);
  let outputText = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    outputText = (outputText + chunk.toString()).slice(-8000);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    outputText = (outputText + chunk.toString()).slice(-8000);
  });
  child.on("error", (error) => {
    outputText = error.message;
  });
  child.on("close", async (code) => {
    try {
      const current = await readSession(id);
      if (current.state === "cancelled") return;
      current.pid = null;
      current.finished_at = new Date().toISOString();
      if (code === 0) {
        const raw = await readFile(
          path.join(output, `source.recognition.json`),
        );
        const result = parseRecognition(JSON.parse(raw.toString("utf8")));
        if (result.source.sha256.toLowerCase() !== current.audio_sha256)
          throw new Error("Hash audio de sortie incohérent");
        await writeFile(path.join(output, "prediction.recognition.json"), raw);
        current.prediction_sha256 = sha(raw);
        current.state = "done";
      } else {
        const detail = outputText
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .at(-1);
        current.state = "failed";
        current.error = `Reconnaissance interrompue avant la production d’un résultat. ${detail || "Vérifie les modèles, le corpus et le format audio."}`;
      }
      await saveSession(current);
    } catch (error) {
      const current = await readSession(id);
      current.state = "failed";
      current.error =
        error instanceof Error ? error.message : "Résultat invalide";
      current.pid = null;
      await saveSession(current);
    } finally {
      // Libère le job seulement maintenant : jusque-là, aucun lecteur ne sonde le processus.
      if (jobs.get(id)?.child === child) jobs.delete(id);
      settle();
    }
  });
}
/** Se résout quand le gestionnaire `close` du traitement de `id` a fini (immédiat sans traitement). */
export function jobSettled(id: string): Promise<void> {
  return jobs.get(id)?.settled ?? Promise.resolve();
}
export async function cancel(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) throw new Error("Aucun traitement actif dans ce serveur");
  const session = await readSession(id);
  session.state = "cancelled";
  session.pid = null;
  session.finished_at = new Date().toISOString();
  await saveSession(session);
  job.child.kill();
}
