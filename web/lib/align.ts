import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { engineArgs, lastError, runPython, type PythonRunner } from "./python";
import { proposalsFromDecisions } from "./decision-proposals";
import { readDecisions } from "./decisions-store";
import {
  REPO,
  atomicJson,
  audioPath,
  readResult,
  readSession,
  sessionDir,
} from "./store";
import {
  applyAlignment,
  applyProposals,
  emptyValidation,
  validatedDocument,
  validationSchema,
  type Validation,
} from "./validation";

/** Étape A (ADR-0006) côté serveur : propositions, alignement et écriture dans le manifeste. */
const busy = new Set<string>();

export async function readValidation(id: string): Promise<Validation> {
  const session = await readSession(id);
  try {
    const raw = await readFile(
      path.join(sessionDir(id), "validation.json"),
      "utf8",
    );
    const value = validationSchema.parse(JSON.parse(raw));
    if (value.audio_sha256 !== session.audio_sha256)
      throw new Error("Validation d'un autre audio.");
    return value;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return emptyValidation(id, session.audio_sha256);
    throw e;
  }
}
export async function saveValidation(value: Validation): Promise<void> {
  await atomicJson(
    path.join(sessionDir(value.session_id), "validation.json"),
    validationSchema.parse(value),
  );
}

async function exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
  if (busy.has(id))
    throw new Error("Un alignement est déjà en cours pour cette session.");
  busy.add(id);
  try {
    return await work();
  } finally {
    busy.delete(id);
  }
}

export function manifestPath(): string {
  return (
    process.env.AQR_MANIFEST ||
    path.join(REPO, "tests", "fixtures", "audio", "manifest.yaml")
  );
}

/** Passages proposés à partir de la prédiction du moteur (`aqr plan-alignment`). */
export async function proposeValidation(
  id: string,
  run: PythonRunner = runPython,
): Promise<Validation> {
  const session = await readSession(id);
  if (session.state !== "done")
    throw new Error(
      "Lance d'abord la reconnaissance : les propositions en partent.",
    );
  const prediction = path.join(sessionDir(id), "prediction.recognition.json");
  const result = await run(["plan-alignment", prediction]);
  if (result.code !== 0) throw new Error(lastError(result));
  const next = applyProposals(
    await readValidation(id),
    JSON.parse(result.stdout),
  );
  await saveValidation(next);
  return next;
}

/**
 * Passages proposés par les corrections ÉCOUTÉES de l'export (ADR-0014) : seulement les décisions de
 * nature factuelle, écoutées, dont l'auteur a consenti (consentement du document ET de la décision),
 * encore appliquées à un passage de l'analyse courante. Statut `proposed` : rien n'entre seul dans le
 * manifeste, un administrateur écoute, aligne puis valide.
 */
export async function proposeFromDecisions(id: string): Promise<Validation> {
  const [doc, result, current] = await Promise.all([
    readDecisions(id),
    readResult(id),
    readValidation(id),
  ]);
  const proposals = proposalsFromDecisions(
    doc,
    (result?.parsed.intervals ?? []) as never,
    new Set(current.passages.map((p) => p.id)),
  );
  if (!proposals.length) return current;
  const next: Validation = {
    ...current,
    passages: [...current.passages, ...proposals].sort(
      (a, b) => a.t[0] - b.t[0],
    ),
    updated_at: new Date().toISOString(),
  };
  await saveValidation(next);
  return next;
}

/** Aligne les passages `ids` en un seul lancement du modèle (`aqr align --plan`). */
export async function alignValidation(
  id: string,
  ids: string[],
  run: PythonRunner = runPython,
): Promise<Validation> {
  return exclusive(id, async () => {
    const models = process.env.AQR_MODELS_DIR;
    if (!models)
      throw new Error(
        "AQR_MODELS_DIR absent : les poids du modèle ne sont pas configurés sur cette machine.",
      );
    const current = await readValidation(id);
    const chosen = ids.map((pid) => {
      const passage = current.passages.find((p) => p.id === pid);
      if (!passage) throw new Error("Passage inconnu");
      return passage;
    });
    if (!chosen.length) throw new Error("Aucun passage à aligner.");
    const dir = path.join(sessionDir(id), "alignment");
    await mkdir(dir, { recursive: true });
    const plan = path.join(dir, "plan.json");
    await writeFile(
      plan,
      JSON.stringify({
        schema: "aqr.align-plan/1",
        source: { sha256: current.audio_sha256 },
        passages: chosen.map((p) => ({ t: p.t, verses: p.verses })),
      }),
    );
    const source = await audioPath(id);
    const result = await run([
      "align",
      source,
      "--plan",
      plan,
      "--out-dir",
      dir,
      "--force",
      ...engineArgs(models),
    ]);
    const output = path.join(dir, `${path.parse(source).name}.alignment.json`);
    if (result.code !== 0) throw new Error(lastError(result));
    const document = JSON.parse(await readFile(output, "utf8"));
    // Relu après l'alignement : une édition faite pendant le calcul n'est pas écrasée.
    const latest = await readValidation(id);
    const unchanged = chosen
      .filter((p) => {
        const now = latest.passages.find((q) => q.id === p.id);
        return (
          now &&
          now.verses === p.verses &&
          now.t[0] === p.t[0] &&
          now.t[1] === p.t[1]
        );
      })
      .map((p) => p.id);
    const kept = {
      ...document,
      passages: document.passages.filter((_: unknown, i: number) =>
        unchanged.includes(chosen[i].id),
      ),
    };
    const next = applyAlignment(latest, unchanged, kept);
    await saveValidation(next);
    return next;
  });
}

/** Passages validés -> vérité terrain du manifeste (`aqr data import-alignment`). */
export async function writeManifest(
  id: string,
  reviewedBy: string,
  run: PythonRunner = runPython,
): Promise<{ validation: Validation; report: string }> {
  return exclusive(id, async () => {
    const current = await readValidation(id);
    const document = validatedDocument(current);
    const file = path.join(
      sessionDir(id),
      "alignment",
      "validated.alignment.json",
    );
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(document, null, 1));
    const date = new Date().toISOString().slice(0, 10);
    const result = await run([
      "data",
      "--manifest",
      manifestPath(),
      "import-alignment",
      file,
      "--reviewed-by",
      reviewedBy,
      "--date",
      date,
    ]);
    if (result.code !== 0) throw new Error(lastError(result));
    const report = result.stdout.trim().split(/\r?\n/).at(-1) || "écrit";
    const next: Validation = {
      ...current,
      written: [...current.written, { at: new Date().toISOString(), report }],
      updated_at: new Date().toISOString(),
    };
    await saveValidation(next);
    return { validation: next, report };
  });
}
