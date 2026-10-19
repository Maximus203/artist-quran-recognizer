import { spawn } from "node:child_process";
import path from "node:path";
import { REPO } from "./store";

/** Interpréteur du moteur (`AQR_PYTHON`, défaut `python`) lancé depuis la racine du dépôt. */
export function pythonCommand(): { python: string; env: NodeJS.ProcessEnv } {
  return {
    python: process.env.AQR_PYTHON || "python",
    // UTF-8 forcé : sous Windows, Python écrirait ses messages en cp1252 (guillemets illisibles).
    env: {
      ...process.env,
      PYTHONPATH: path.join(REPO, "src"),
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
  };
}

/** Modèles, corpus et verrou des modèles : les mêmes pour toute commande du moteur. */
export function engineArgs(models: string): string[] {
  return [
    "--models-dir",
    models,
    "--corpus-dir",
    process.env.AQR_CORPUS_DIR || path.join(REPO, "data", "corpus"),
    "--lock",
    path.join(REPO, "models", "LOCK.json"),
  ];
}

export type PythonRun = { code: number | null; stdout: string; stderr: string };
export type PythonRunner = (args: string[]) => Promise<PythonRun>;

/** `python -m aqr.cli <args>` jusqu'à sa fin ; sorties gardées (bornées) pour le diagnostic. */
export const runPython: PythonRunner = (args) =>
  new Promise((resolve) => {
    const { python, env } = pythonCommand();
    const child = spawn(
      /* turbopackIgnore: true */ python,
      ["-m", "aqr.cli", ...args],
      {
        cwd: REPO,
        shell: false,
        windowsHide: true,
        env,
      },
    );
    let stdout = "",
      stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-2_000_000);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    child.on("error", (error) =>
      resolve({ code: null, stdout, stderr: error.message }),
    );
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });

/** Dernière ligne utile d'une sortie d'erreur (les journaux NeMo la précèdent). */
export function lastError(run: PythonRun): string {
  return (
    run.stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) => line.startsWith("ERREUR") || line.startsWith("Variable"),
      )
      .at(-1) ||
    run.stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1) ||
    "le moteur s'est arrêté sans message"
  );
}
