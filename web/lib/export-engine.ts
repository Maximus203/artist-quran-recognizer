import { createHash, randomUUID } from "node:crypto";
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import {
  EXPORT_FORMATS,
  exportFileName,
  type ExportOptions,
} from "./export-options";
import { exportBlockingTags } from "./review-presets";
import {
  lastError,
  runPython,
  type PythonRun,
  type PythonRunner,
} from "./python";
import { REPO, readSession, sessionDir } from "./store";

/**
 * Le moteur d'export vu du serveur : `aqr export-readiness`, `aqr export-subtitles` et
 * `aqr corpus-verse` lancés comme `recognize` (jamais un second moteur de rendu en TypeScript : le
 * serveur n'a pas le corpus, et deux rendus finiraient par diverger). Ce module ne connaît ni les
 * routes ni les comptes : il construit la ligne de commande, borne la concurrence, mémorise les
 * réponses identiques et traduit les codes de sortie en erreurs lisibles.
 */

export class NotReadyError extends Error {
  constructor() {
    super(
      "L'analyse n'est pas terminée : il n'y a pas encore de résultat à exporter.",
    );
    this.name = "NotReadyError";
  }
}
/** Des passages ambigus restent à corriger et l'export n'est pas forcé (`409 unresolved_items`). */
export class UnresolvedItemsError extends Error {
  constructor(public readonly unresolved: number) {
    super(`${unresolved} passage(s) ambigu(s) restent à corriger.`);
    this.name = "UnresolvedItemsError";
  }
}
/** Le moteur a refusé les entrées (option inconnue, fichier illisible) : un message à montrer. */
export class EngineInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineInputError";
  }
}

function corpusArgs(): string[] {
  return [
    "--corpus-dir",
    process.env.AQR_CORPUS_DIR || path.join(REPO, "data", "corpus"),
  ];
}

// --- concurrence et mémoire ----------------------------------------------------------------

const MAX_PROCESSES = 3;
const MAX_CACHED = 32;
type Shared = {
  running: number;
  waiting: (() => void)[];
  cache: Map<string, unknown>;
  inflight: Map<string, Promise<unknown>>;
};
const KEY = Symbol.for("aqr.export-engine");
const shared: Shared = ((globalThis as { [KEY]?: Shared })[KEY] ??= {
  running: 0,
  waiting: [],
  cache: new Map(),
  inflight: new Map(),
});

/** Au plus `MAX_PROCESSES` processus Python à la fois : frapper dans un champ ne les empile pas. */
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (shared.running >= MAX_PROCESSES)
    await new Promise<void>((resolve) => shared.waiting.push(resolve));
  shared.running += 1;
  try {
    return await task();
  } finally {
    shared.running -= 1;
    shared.waiting.shift()?.();
  }
}

/** Réponses identiques : mémorisées (clé = empreinte des entrées) et les demandes simultanées partagent un calcul. */
async function memo<T>(key: string, compute: () => Promise<T>): Promise<T> {
  if (shared.cache.has(key)) {
    const hit = shared.cache.get(key) as T;
    shared.cache.delete(key);
    shared.cache.set(key, hit);
    return hit;
  }
  const running = shared.inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const promise = limited(compute)
    .then((value) => {
      shared.cache.set(key, value);
      while (shared.cache.size > MAX_CACHED)
        shared.cache.delete(shared.cache.keys().next().value as string);
      return value;
    })
    .finally(() => shared.inflight.delete(key));
  shared.inflight.set(key, promise);
  return promise;
}
export function clearExportCache(): void {
  shared.cache.clear();
}

async function stamp(file: string): Promise<string> {
  try {
    const info = await stat(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return "absent";
  }
}

// --- lancement -----------------------------------------------------------------------------

type Files = { prediction: string; decisions: string; review: string };
async function filesOf(id: string): Promise<Files> {
  const session = await readSession(id);
  if (session.state !== "done") throw new NotReadyError();
  const dir = sessionDir(id);
  const files = {
    prediction: path.join(dir, "prediction.recognition.json"),
    decisions: path.join(dir, "decisions.json"),
    review: path.join(dir, "review.json"),
  };
  try {
    await stat(files.prediction);
  } catch {
    throw new NotReadyError();
  }
  return files;
}

async function fileArgs(files: Files): Promise<string[]> {
  const args = [files.prediction];
  if ((await stamp(files.decisions)) !== "absent")
    args.push("--decisions", files.decisions);
  if ((await stamp(files.review)) !== "absent")
    args.push("--review", files.review);
  return [...args, "--blocking-tags", exportBlockingTags().join(",")];
}

function parseJson<T>(run: PythonRun): T {
  try {
    return JSON.parse(run.stdout) as T;
  } catch {
    throw new Error("Le moteur d'export a répondu autre chose que du JSON.");
  }
}

/** Codes de sortie du moteur : 3 = passages à corriger, 1 = entrées refusées, 2 ou autre = panne. */
function check(run: PythonRun): void {
  if (run.code === 0) return;
  if (run.code === 3) {
    const body = (() => {
      try {
        return JSON.parse(run.stdout) as { unresolved?: number };
      } catch {
        return {};
      }
    })();
    throw new UnresolvedItemsError(body.unresolved ?? 0);
  }
  if (run.code === 1) throw new EngineInputError(lastError(run));
  throw new Error(lastError(run));
}

// --- API -----------------------------------------------------------------------------------

export type ReadinessQuery = {
  page?: number;
  size?: number;
  type?: string | null;
};

export async function readiness(
  id: string,
  options: ExportOptions,
  query: ReadinessQuery = {},
  run: PythonRunner = runPython,
): Promise<unknown> {
  const files = await filesOf(id);
  const session = await readSession(id);
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        "readiness",
        id,
        session.prediction_sha256,
        await stamp(files.decisions),
        await stamp(files.review),
        options,
        query,
        exportBlockingTags(),
      ]),
    )
    .digest("hex");
  return memo(key, async () => {
    const result = await run([
      "export-readiness",
      ...(await fileArgs(files)),
      ...corpusArgs(),
      "--options",
      JSON.stringify(options),
      "--page",
      String(query.page ?? 0),
      "--size",
      String(query.size ?? 10),
      ...(query.type ? ["--type", query.type] : []),
    ]);
    check(result);
    return parseJson<unknown>(result);
  });
}

export type ExportSummary = {
  schema: string;
  format: string;
  cues: number;
  omitted: unknown[];
  forced: boolean;
  unresolved: number;
  attribution: string[];
  warnings: string[];
  [key: string]: unknown;
};

export async function previewSubtitles(
  id: string,
  options: ExportOptions,
  cues = 3,
  run: PythonRunner = runPython,
): Promise<ExportSummary> {
  const files = await filesOf(id);
  const session = await readSession(id);
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        "preview",
        id,
        session.prediction_sha256,
        await stamp(files.decisions),
        await stamp(files.review),
        options,
        cues,
        exportBlockingTags(),
      ]),
    )
    .digest("hex");
  return memo(key, async () => {
    const result = await run([
      "export-subtitles",
      ...(await fileArgs(files)),
      ...corpusArgs(),
      "--options",
      JSON.stringify(options),
      "--preview",
      String(cues),
    ]);
    check(result);
    return parseJson<ExportSummary>(result);
  });
}

export type ExportFile = {
  summary: ExportSummary;
  name: string;
  mime: string;
  content: string;
};

const MIME: Record<string, string> = {
  srt: "application/x-subrip; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
  ass: "text/x-ssa; charset=utf-8",
  json: "application/json; charset=utf-8",
};

/** Écrit le fichier (jamais mémorisé : un export est un acte), le relit et le supprime. */
export async function exportSubtitles(
  id: string,
  options: ExportOptions,
  fileName?: string,
  run: PythonRunner = runPython,
): Promise<ExportFile> {
  if (!EXPORT_FORMATS.includes(options.format))
    throw new EngineInputError("Format inconnu.");
  const files = await filesOf(id);
  const session = await readSession(id);
  const out = path.join(
    sessionDir(id),
    "exports",
    `subtitles-${randomUUID()}.${options.format}`,
  );
  try {
    const result = await limited(async () =>
      run([
        "export-subtitles",
        ...(await fileArgs(files)),
        ...corpusArgs(),
        "--options",
        JSON.stringify(options),
        "--out",
        out,
        "--force",
      ]),
    );
    check(result);
    const summary = parseJson<ExportSummary>(result);
    const content = (await readFile(out)).toString("utf8");
    return {
      summary,
      name: exportFileName(session.name, options, fileName),
      mime: MIME[options.format],
      content,
    };
  } finally {
    await rm(out, { force: true }).catch(() => undefined);
  }
}

export type VerseLookup =
  | {
      ok: true;
      ref: string;
      words: [number, number];
      words_total: number;
      tokens: string[];
      verse_tokens: string[];
      translation: string | null;
      translation_scope: string | null;
    }
  | { ok: false; error: string };

const REF = /^\d{1,3}:\d{1,3}$/;
const WORDS = /^\d{1,3}(-\d{1,3})?$/;

/** Un verset lu dans le corpus (écran de correction). Les entrées sont validées avant tout lancement. */
export async function corpusVerse(
  ref: string,
  words: string | null,
  run: PythonRunner = runPython,
): Promise<VerseLookup> {
  if (!REF.test(ref)) return { ok: false, error: "Ce verset n'existe pas." };
  if (words !== null && !WORDS.test(words))
    return { ok: false, error: "Plage de mots invalide." };
  return memo(`verse:${ref}:${words ?? ""}`, async () => {
    const result = await run([
      "corpus-verse",
      ref,
      ...(words ? ["--words", words] : []),
      ...corpusArgs(),
    ]);
    if (result.code === 0 || result.code === 1) {
      try {
        return JSON.parse(result.stdout) as VerseLookup;
      } catch {
        /* sortie illisible : traitée comme une panne ci-dessous */
      }
    }
    throw new Error(lastError(result));
  });
}
