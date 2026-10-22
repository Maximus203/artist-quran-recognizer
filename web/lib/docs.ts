import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { log } from "./log";
import { REPO } from "./store";

/**
 * Documentation servie aux testeurs connectés. LISTE BLANCHE stricte : seul ce que
 * `docs/docs-index.json` déclare (`[{ slug, title, section, file }]`) est lisible, par son
 * `slug` ; aucun chemin ne vient jamais de la requête. `file` est relatif à la racine du dépôt
 * (à défaut, au dossier `docs/`), doit se terminer par `.md`, ne contient ni `..` ni segment
 * caché, et le fichier réel (liens symboliques résolus) doit rester dans le dépôt.
 */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

const entrySchema = z.object({
  slug: z.string().regex(SLUG),
  title: z.string().min(1).max(200),
  section: z.string().min(1).max(100),
  /** Une ou deux phrases pour la liste (facultatif). */
  summary: z.string().max(600).optional(),
  file: z
    .string()
    .min(1)
    .max(300)
    .refine(isSafeRelative, "chemin de fichier non autorisé"),
});
export type DocEntry = z.infer<typeof entrySchema>;
/** Ce que l'API expose d'une entrée : jamais le chemin du fichier. */
export type DocSummary = Omit<DocEntry, "file">;

function isSafeRelative(file: string): boolean {
  if (!file.endsWith(".md")) return false;
  if (
    file.includes("\\") ||
    file.includes("\0") ||
    path.isAbsolute(file) ||
    /^[a-z]:/i.test(file)
  )
    return false;
  return file
    .split("/")
    .every(
      (part) =>
        part !== "" && part !== "." && part !== ".." && !part.startsWith("."),
    );
}

export const docsRoot = (repo = REPO) => path.join(repo, "docs");

export async function loadDocsIndex(repo = REPO): Promise<DocEntry[]> {
  let raw: string;
  try {
    raw = await readFile(path.join(docsRoot(repo), "docs-index.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const parsed = z.array(z.unknown()).safeParse(safeJson(raw));
  if (!parsed.success) {
    log.warn(
      "docs",
      "docs-index.json n'est pas un tableau : documentation vide",
    );
    return [];
  }
  const seen = new Set<string>();
  const entries: DocEntry[] = [];
  for (const item of parsed.data) {
    const entry = entrySchema.safeParse(item);
    if (!entry.success || seen.has(entry.data.slug)) {
      log.warn("docs", "entrée d'index ignorée (invalide ou en double)");
      continue;
    }
    seen.add(entry.data.slug);
    entries.push(entry.data);
  }
  return entries;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const summarize = ({
  slug,
  title,
  section,
  summary,
}: DocEntry): DocSummary => ({
  slug,
  title,
  section,
  ...(summary === undefined ? {} : { summary }),
});

/** Contenu Markdown d'une entrée de l'index, ou `null` (slug inconnu, fichier absent ou hors du dépôt). */
export async function readDoc(
  slug: string,
  repo = REPO,
): Promise<string | null> {
  if (!SLUG.test(slug)) return null;
  const entry = (await loadDocsIndex(repo)).find((item) => item.slug === slug);
  if (!entry) return null;
  const root = await realpath(repo);
  for (const base of [repo, docsRoot(repo)]) {
    const candidate = path.resolve(base, entry.file);
    try {
      const real = await realpath(candidate);
      if (real !== root && !real.startsWith(root + path.sep)) continue;
      return await readFile(real, "utf8");
    } catch {
      /* essai suivant */
    }
  }
  return null;
}
