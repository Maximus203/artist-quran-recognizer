/**
 * Notes de version : lecture de `docs/RELEASE-NOTES.md`, servi par `/api/docs/release-notes`.
 * Format strict (contrôlé par `scripts/check_docs_index.py`) : un titre `## AAAA-MM-JJ — Titre`,
 * puis `Étiquettes : …`, `PR : #NN`, puis le corps en Markdown. Fonction pure : le texte arrive
 * déjà lu, rien n'est inventé (une entrée mal formée est ignorée, jamais complétée).
 */
export const RELEASE_TAGS = ["utilisateur", "technique", "decision"] as const;
export type ReleaseTag = (typeof RELEASE_TAGS)[number];

export const RELEASE_TAG_LABELS: Record<ReleaseTag, string> = {
  utilisateur: "Utilisateur",
  technique: "Technique",
  decision: "Décision",
};

export type ReleaseEntry = {
  /** AAAA-MM-JJ */
  date: string;
  title: string;
  tags: ReleaseTag[];
  prs: number[];
  /** Markdown du corps (à rendre sans HTML brut). */
  body: string;
};

const HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s*[—–-]\s*(.+?)\s*$/;
const COMMENT = /<!--[\s\S]*?-->/g;

const strip = (text: string): string =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const lineValue = (line: string, label: string): string | null => {
  const match = new RegExp(`^${label}\\s*:\\s*(.*)$`, "i").exec(strip(line));
  if (!match) return null;
  // On relit la valeur dans la ligne d'origine (même longueur de préfixe : « etiquettes : »).
  return line.slice(line.indexOf(":") + 1).trim();
};

function parseTags(value: string): ReleaseTag[] {
  const found: ReleaseTag[] = [];
  for (const part of value.split(",")) {
    const tag = strip(part.trim());
    const known = RELEASE_TAGS.find((t) => t === tag);
    if (known && !found.includes(known)) found.push(known);
  }
  return found;
}

function parsePrs(value: string): number[] {
  const numbers: number[] = [];
  for (const match of value.matchAll(/#(\d+)/g)) {
    const n = Number(match[1]);
    if (Number.isSafeInteger(n) && n > 0 && !numbers.includes(n))
      numbers.push(n);
  }
  return numbers;
}

export function parseReleaseNotes(markdown: string): ReleaseEntry[] {
  const lines = markdown.replace(COMMENT, "").split(/\r?\n/);
  const entries: ReleaseEntry[] = [];
  let current: {
    date: string;
    title: string;
    tags: ReleaseTag[];
    prs: number[];
    body: string[];
  } | null = null;
  const close = () => {
    if (current)
      entries.push({
        ...current,
        body: current.body.join("\n").trim(),
      });
    current = null;
  };
  for (const line of lines) {
    const heading = HEADING.exec(line);
    if (heading) {
      close();
      current = {
        date: heading[1],
        title: heading[2],
        tags: [],
        prs: [],
        body: [],
      };
      continue;
    }
    if (!current) continue;
    const tags = lineValue(line, "etiquettes");
    if (tags !== null && current.body.every((l) => l.trim() === "")) {
      current.tags = parseTags(tags);
      continue;
    }
    const prs = lineValue(line, "pr");
    if (prs !== null && current.body.every((l) => l.trim() === "")) {
      current.prs = parsePrs(prs);
      continue;
    }
    current.body.push(line);
  }
  close();
  return entries;
}

export const pullRequestUrl = (repoUrl: string, number: number): string =>
  `${repoUrl.replace(/\/+$/, "")}/pull/${number}`;
