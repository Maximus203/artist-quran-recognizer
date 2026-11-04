import { transient } from "./chunked-upload-client";
import { isActiveJob, type ServerJob } from "./export-video-jobs-client";

/**
 * Suivre le rendu d'un export confié au serveur. Le rendu continue sans la page : une coupure de réseau ne
 * l'interrompt pas, on réessaie jusqu'à ce qu'il se termine. Ce qui est nouveau : la coupure est ANNONCÉE (une
 * fois à la perte, une fois au retour) pour que la page ne laisse pas croire qu'elle avance quand elle ne reçoit
 * plus rien. Aucun DOM ici : l'écran branche ses callbacks.
 */
export type FollowDeps = {
  fetchJob: () => Promise<ServerJob>;
  sleep: (ms: number) => Promise<void>;
  /** Faux dès que la page est quittée : la boucle s'arrête sans rien mettre à jour. */
  alive: () => boolean;
  /** Chaque relevé d'avancement reçu (le dernier compris). */
  onJob: (job: ServerJob) => void;
  /** Le réseau vient d'être perdu (`false`) ou retrouvé (`true`) — seulement aux changements. */
  onConnection: (online: boolean) => void;
  /** Attente entre deux relevés (ms). */
  interval: number;
};

/** Rend le job terminé (réussi, échoué ou annulé), ou `null` si la page a été quittée avant. */
export async function followJob(deps: FollowDeps): Promise<ServerJob | null> {
  let online = true;
  for (;;) {
    let job: ServerJob;
    try {
      job = await deps.fetchJob();
    } catch (error) {
      // Réseau coupé, serveur qui redémarre ou page en transition : le rendu continue côté serveur, on réessaie.
      // Seule une panne passagère est annoncée comme une coupure ; toute autre erreur est réessayée sans bruit.
      if (online && transient(error) && deps.alive()) {
        online = false;
        deps.onConnection(false);
      }
      await deps.sleep(deps.interval);
      if (!deps.alive()) return null;
      continue;
    }
    if (!deps.alive()) return null;
    if (!online) {
      online = true;
      deps.onConnection(true);
    }
    deps.onJob(job);
    if (!isActiveJob(job)) return job;
    await deps.sleep(deps.interval);
    if (!deps.alive()) return null;
  }
}
