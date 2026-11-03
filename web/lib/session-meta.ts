import type { AsrChoice } from "./asr-choice";
import type { Session } from "./store";

/**
 * « Non lu » : un résultat terminé (réussi ou en échec) dont l'utilisateur n'a pas encore ouvert
 * le détail. `viewed_at === null` est posé à la fin de chaque analyse ; une session d'avant le
 * suivi n'a pas du tout ce champ (`undefined`) : elle est considérée lue, pas de point fantôme.
 */
export function isUnread(
  session: Pick<Session, "state"> & { viewed_at?: string | null },
): boolean {
  return (
    (session.state === "done" || session.state === "failed") &&
    session.viewed_at === null
  );
}

/** Nom court du moteur d'après `engine.asr` de la sortie (`fastconformer-quran@b33a…`). */
export function engineFromLabel(label: string): AsrChoice | null {
  if (label.startsWith("cascade")) return "cascade";
  if (label.startsWith("muno")) return "muno-streaming";
  if (label.startsWith("fastconformer")) return "fastconformer";
  if (label.startsWith("whisper")) return "whisper";
  return null;
}

/** Moteur d'une session : celui qu'elle a persisté, sinon celui demandé, sinon celui de la sortie. */
export function sessionEngine(
  session: Pick<Session, "engine" | "asr">,
  predictionLabel: string | undefined,
): AsrChoice | null {
  return (
    session.engine ??
    session.asr ??
    (predictionLabel ? engineFromLabel(predictionLabel) : null)
  );
}

/** Durée réelle en secondes entre deux dates ISO ; null si l'une manque ou si l'ordre est faux. */
export function realDurationSeconds(
  startedAt: string | null | undefined,
  finishedAt: string | null | undefined,
): number | null {
  if (!startedAt || !finishedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(finishedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return null;
  return Math.round(end - start) / 1000;
}

/** Temps écoulé depuis `startedAt` (borné à 0 si l'horloge a reculé) ; null sans date valide. */
export function elapsedSeconds(
  startedAt: string | null | undefined,
  now: number,
): number | null {
  if (!startedAt) return null;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return null;
  return Math.max(0, Math.round(now - start) / 1000);
}
