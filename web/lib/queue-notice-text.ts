/**
 * Texte de la pastille « file » (côté navigateur) : construit uniquement à partir de ce que l'API
 * `/api/queue` a déjà préparé pour CET utilisateur. Aucune donnée d'un autre compte n'y entre.
 */
export type QueueNoticeInput = {
  mine: Array<{
    kind: "analysis" | "video";
    state: "running" | "queued";
    position: number | null;
    position_label: string | null;
    eta_label: string;
  }>;
  message: string | null;
};

const noun = (kind: "analysis" | "video") =>
  kind === "video" ? "Votre export vidéo" : "Votre analyse";

export function queueNoticeLines(status: QueueNoticeInput | null): string[] {
  if (!status) return [];
  const lines: string[] = [];
  const waiting = status.mine
    .filter((m) => m.state === "queued")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
  const running = status.mine.find((m) => m.state === "running");
  if (waiting)
    lines.push(
      `${noun(waiting.kind)} : ${waiting.position_label ?? "en attente"} · ${waiting.eta_label}`,
    );
  else if (running) lines.push(`${noun(running.kind)} est en cours.`);
  if (status.message) lines.push(status.message);
  return lines;
}
