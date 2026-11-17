import { can, canView, isAdmin, type Actor } from "./access";
import type { Db } from "./db";
import { listFiles, type FileEntry } from "./export-index";
import { getMeta } from "./session-index";
import type { PublicVideoJob } from "./video-jobs";

/**
 * Vue unique des téléchargements : les vidéos prêtes (gardées sur le serveur) ET les exports de la file
 * (en attente, en cours, échoués, ou terminés mais non gardés), regroupés par génération. C'est LE point où
 * s'appliquent les règles de visibilité (Service : il compose deux sources, la route ne fait que
 * sérialiser) :
 *  - fichier prêt : visible si la génération l'est (propriétaire, portée publique, administrateur) ;
 *  - export en file : visible à son lanceur et à l'administrateur, et seulement tant que le lanceur peut
 *    encore voir la génération (une génération repassée en privé disparaît de sa liste) ;
 *  - supprimer un fichier : propriétaire de la génération ou administrateur ; annuler un export actif :
 *    son lanceur ou l'administrateur.
 */
export type JobSnapshot = PublicVideoJob & { userId: number };

export type DownloadJobItem = {
  kind: "job";
  id: string;
  state: PublicVideoJob["state"];
  /** « Vidéo 2/5 : rendu 64 % » : lisible tel quel. */
  progress: string;
  ratio: number;
  files_done: number;
  files_total: number | null;
  error: string | null;
  created_at: string;
  launcher_name: string | null;
  can_cancel: boolean;
  downloads: { name: string; url: string }[];
};

export type DownloadFileItem = {
  kind: "file";
  id: string;
  name: string;
  bytes: number;
  created_at: string;
  launcher_name: string | null;
  download_url: string;
  can_delete: boolean;
};

export type DownloadGroup = {
  session_id: string;
  session_name: string;
  owner_name: string | null;
  /** La génération est la mienne. */
  mine: boolean;
  /** Exports en attente ou en cours pour cette génération (visibles par le demandeur). */
  active: number;
  items: Array<DownloadJobItem | DownloadFileItem>;
};

export type Downloads = {
  groups: DownloadGroup[];
  total_bytes: number;
  active: number;
};

const isActive = (state: PublicVideoJob["state"]) =>
  state === "queued" || state === "running";

const jobDownloadUrl = (sessionId: string, jobId: string, relative: string) =>
  `/api/sessions/${sessionId}/export/video/jobs/${jobId}/${relative}`;

/** Un export terminé dont les vidéos sont déjà dans la liste des fichiers prêts n'est pas listé deux fois. */
function absorbed(job: JobSnapshot, kept: FileEntry[]): boolean {
  if (job.state !== "done" || job.files_done === 0) return false;
  const since = Date.parse(job.createdAt);
  const fresh = kept.filter(
    (file) =>
      file.sessionId === job.sessionId && Date.parse(file.createdAt) >= since,
  );
  return fresh.length >= job.files_done;
}

export function buildDownloads(
  db: Db,
  viewer: Actor,
  jobs: JobSnapshot[],
): Downloads {
  const files = listFiles(db, viewer);
  const groups = new Map<string, DownloadGroup>();
  const lastActivity = new Map<string, string>();
  const names = new Map<number, string | null>();
  const nameOf = (id: number): string | null => {
    if (!names.has(id)) {
      const row = db
        .prepare("SELECT username FROM users WHERE id = ?")
        .get(id) as { username: string } | undefined;
      names.set(id, row?.username ?? null);
    }
    return names.get(id) ?? null;
  };
  const touch = (sessionId: string, at: string) => {
    if (at > (lastActivity.get(sessionId) ?? ""))
      lastActivity.set(sessionId, at);
  };
  const groupOf = (
    sessionId: string,
    name: string,
    ownerId: number | null,
    ownerName: string | null,
  ): DownloadGroup => {
    let group = groups.get(sessionId);
    if (!group) {
      group = {
        session_id: sessionId,
        session_name: name,
        owner_name: ownerName,
        mine: ownerId !== null && ownerId === viewer.id,
        active: 0,
        items: [],
      };
      groups.set(sessionId, group);
    }
    return group;
  };

  for (const file of files) {
    const resource = {
      owner_id: file.sessionOwnerId,
      visibility: file.visibility,
    };
    groupOf(
      file.sessionId,
      file.sessionName,
      file.sessionOwnerId,
      file.ownerName,
    ).items.push({
      kind: "file",
      id: file.id,
      name: file.name,
      bytes: file.bytes,
      created_at: file.createdAt,
      launcher_name: file.launcherName,
      download_url: `/api/sessions/${file.sessionId}/videos/${file.id}?download=1`,
      can_delete: can(viewer, "delete", resource),
    });
    touch(file.sessionId, file.createdAt);
  }

  for (const job of jobs) {
    if (job.userId !== viewer.id && !isAdmin(viewer)) continue;
    const meta = getMeta(db, job.sessionId);
    if (!meta || !canView(viewer, meta)) continue;
    if (absorbed(job, files)) continue;
    const group = groupOf(
      meta.id,
      meta.name,
      meta.owner_id,
      meta.owner_name ?? null,
    );
    if (isActive(job.state)) group.active += 1;
    group.items.push({
      kind: "job",
      id: job.id,
      state: job.state,
      progress: job.progress,
      ratio: job.ratio,
      files_done: job.files_done,
      files_total: job.files_total,
      error: job.error,
      created_at: job.createdAt,
      launcher_name: nameOf(job.userId),
      can_cancel:
        isActive(job.state) && (job.userId === viewer.id || isAdmin(viewer)),
      downloads: job.downloads.map((d) => ({
        name: d.name,
        url: jobDownloadUrl(job.sessionId, job.id, d.url),
      })),
    });
    touch(job.sessionId, job.createdAt);
  }

  // Exports actifs d'abord (en tête de page), les plus récents ensuite ; dans un groupe : les exports de la
  // file (le plus récent d'abord) puis les fichiers prêts, le plus gros d'abord comme l'inventaire.
  const ordered = [...groups.values()].sort(
    (a, b) =>
      Number(b.active > 0) - Number(a.active > 0) ||
      (lastActivity.get(b.session_id) ?? "").localeCompare(
        lastActivity.get(a.session_id) ?? "",
      ),
  );
  for (const group of ordered)
    group.items.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "job" ? -1 : 1;
      if (a.kind === "job" && b.kind === "job")
        return b.created_at.localeCompare(a.created_at);
      return (
        ((b as DownloadFileItem).bytes ?? 0) -
        ((a as DownloadFileItem).bytes ?? 0)
      );
    });

  return {
    groups: ordered,
    total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    active: ordered.reduce((sum, group) => sum + group.active, 0),
  };
}
