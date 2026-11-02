import { api } from "./api-client";
import type { VideoJobOptions } from "./video-job-options";

/**
 * Exports vidéo confiés au SERVEUR, côté navigateur : le rendu tourne sur le serveur et continue même
 * si la page est quittée. Ce module est la seule place qui fabrique les adresses et les corps de ces
 * appels ; l'avancement se lit sur `GET …/jobs/{job}`, la liste de la session sur `GET …/jobs`.
 */
export type ServerJobState = "queued" | "running" | "done" | "failed";

export type ServerJob = {
  id: string;
  sessionId: string;
  state: ServerJobState;
  /** « Vidéo 2/5 : rendu 64 % » : lisible tel quel. */
  progress: string;
  /** Avancement réel de la vidéo en cours, de 0 à 1. */
  ratio: number;
  files_done: number;
  files_total: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  download: string | null;
  downloads: { index: number; name: string; url: string }[];
};

const base = (sessionId: string) =>
  `/api/sessions/${sessionId}/export/video/jobs`;

export const isActiveJob = (job: Pick<ServerJob, "state">) =>
  job.state === "queued" || job.state === "running";

/**
 * Lance l'export : `options` (même JSON que « Même export par l'API »), fond d'image facultatif,
 * `reuse` (récupérer une vidéo identique déjà gardée, défaut oui).
 */
export async function startServerExport(
  sessionId: string,
  options: VideoJobOptions,
  background: File | null,
  reuse = true,
): Promise<ServerJob> {
  const body = new FormData();
  body.set("options", JSON.stringify(options));
  body.set("reuse", reuse ? "1" : "0");
  if (background) body.set("background_image", background);
  const { job } = await api<{ job: ServerJob }>(base(sessionId), {
    method: "POST",
    body,
  });
  return job;
}

export const fetchServerJob = (sessionId: string, job: string) =>
  api<{ job: ServerJob }>(`${base(sessionId)}/${job}`).then((r) => r.job);

/** Exports de la session encore actifs ou tout juste terminés, pour reprendre l'affichage. */
export const fetchSessionJobs = (sessionId: string) =>
  api<{ jobs: ServerJob[] }>(base(sessionId)).then((r) => r.jobs);

/** Arrête un export en file ou en cours (la place est rendue). */
export const cancelServerJob = (sessionId: string, job: string) =>
  api(`${base(sessionId)}/${job}`, { method: "DELETE" });

/** Adresse de téléchargement d'un MP4 produit par le job (valable une heure). */
export const serverJobFileUrl = (
  sessionId: string,
  job: string,
  index: number,
) => `${base(sessionId)}/${job}/file${index > 0 ? `?index=${index}` : ""}`;
