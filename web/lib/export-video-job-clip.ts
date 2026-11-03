/**
 * Page de rendu du serveur : va chercher la vidéo de fond choisie pour CE job (muette, H.264) et en fait un
 * fichier que le rendu sait lire comme celui d'un utilisateur (`RenderVideoInputs.bgVideo`). Le fichier est
 * nommé par l'identité de la vidéo (empreinte de l'original), jamais par un chemin : un même fond redonne la même
 * clé de réutilisation, donc une vidéo identique déjà gardée n'est pas refaite.
 */
export const jobBackgroundVideoUrl = (sessionId: string, jobId: string) =>
  `/api/sessions/${sessionId}/export/video/jobs/${jobId}/background-video`;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

const LOST =
  "La vidéo de fond a été retirée ou a expiré pendant l'attente : l'export n'a pas pu l'utiliser. Choisis-la de nouveau, puis relance l'export.";

export async function fetchJobBackgroundVideo(
  sessionId: string,
  jobId: string,
  id: string | null,
  fetcher: Fetcher = (url, init) => fetch(url, init),
): Promise<File> {
  let response: Response;
  try {
    response = await fetcher(jobBackgroundVideoUrl(sessionId, jobId), {
      credentials: "same-origin",
    });
  } catch {
    throw new Error(
      "La vidéo de fond n'a pas pu être lue (connexion interne coupée). Relance l'export.",
    );
  }
  if (!response.ok) throw new Error(LOST);
  const blob = await response.blob();
  if (blob.size === 0)
    throw new Error("La vidéo de fond reçue est vide : relance l'export.");
  return new File([blob], id ?? "fond", {
    type: "video/mp4",
    lastModified: 0,
  });
}
