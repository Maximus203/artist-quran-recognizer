/**
 * Avancement d'un export vidéo, fichier par fichier (une plage = une vidéo) : structuré pour
 * l'écran (liste des fichiers) et résumé en une phrase pour le job API (`progress`).
 */
export type FilePhase = "render" | "send" | "done";

export type FileProgress = {
  /** Position de la vidéo (0 = première). */
  index: number;
  total: number;
  phase: FilePhase;
  /** Avancement de la phase, entre 0 et 1. */
  ratio: number;
  /** Taille du MP4 produit (phase « done »). */
  bytes?: number;
};

export type FileRowState = "wait" | "run" | "done" | "err";
export type FileRow = {
  name: string;
  state: FileRowState;
  ratio: number;
  bytes: number | null;
};

const PHASE_LABEL: Record<FilePhase, string> = {
  render: "rendu",
  send: "assemblage",
  done: "prête",
};

export function fileProgressText(p: FileProgress): string {
  const head = `Vidéo ${p.index + 1}/${p.total} : ${PHASE_LABEL[p.phase]}`;
  return p.phase === "done"
    ? head
    : `${head} ${Math.round(Math.min(1, Math.max(0, p.ratio)) * 100)} %`;
}

export const initialFiles = (names: readonly string[]): FileRow[] =>
  names.map((name) => ({ name, state: "wait", ratio: 0, bytes: null }));

export function applyFileProgress(rows: FileRow[], p: FileProgress): FileRow[] {
  if (p.index < 0 || p.index >= rows.length) return rows;
  return rows.map((row, i) =>
    i !== p.index
      ? row
      : p.phase === "done"
        ? { ...row, state: "done", ratio: 1, bytes: p.bytes ?? row.bytes }
        : {
            ...row,
            state: "run",
            // Rendu des images : 0 → 90 % ; assemblage par le serveur : 90 → 100 %.
            ratio: p.phase === "render" ? p.ratio * 0.9 : 0.9 + p.ratio * 0.1,
          },
  );
}

export const failFile = (rows: FileRow[], index: number): FileRow[] =>
  rows.map((row, i) => (i === index ? { ...row, state: "err" } : row));

export const progressCounts = (
  rows: readonly FileRow[],
): { done: number; total: number } => ({
  done: rows.filter((r) => r.state === "done").length,
  total: rows.length,
});

/** Ce que l'écran dit d'un échec de rendu : jamais le texte technique du navigateur. */
export function renderErrorText(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (
    /failed to fetch|networkerror|network request failed|load failed/i.test(
      message,
    )
  )
    return "La connexion au serveur a été coupée pendant l’envoi de la vidéo (serveur arrêté ou réseau perdu). Vérifie que l’atelier tourne, puis reprends : les vidéos déjà téléchargées sont gardées.";
  if (
    message &&
    /[àâçéèêëîïôûùüÿœ]|\b(le|la|les|une?|des|de|du|est|pas|ce)\b/i.test(message)
  )
    return message;
  return "La vidéo n’a pas pu être fabriquée dans ce navigateur. Reprends l’export ; si cela recommence, baisse la qualité.";
}
