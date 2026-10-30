/**
 * État d'un agent du moteur à distance, tel que l'administrateur le lit. L'agent interroge l'atelier toutes les
 * ~20 s (long polling) ; `last_seen_at` n'est réécrit qu'une fois par 15 s (`engine-agents.ts`) : deux minutes
 * sans signal veulent dire que l'agent a cessé d'appeler.
 */
export const ONLINE_WITHIN_MS = 2 * 60_000;

export type AgentLike = {
  created_at: string;
  last_seen_at: string | null;
  revoked_at: string | null;
};
export type AgentState = "online" | "silent" | "never" | "revoked";

export function agentState(agent: AgentLike, now = Date.now()): AgentState {
  if (agent.revoked_at) return "revoked";
  const seen = agent.last_seen_at ? Date.parse(agent.last_seen_at) : NaN;
  if (!Number.isFinite(seen)) return "never";
  return now - seen <= ONLINE_WITHIN_MS ? "online" : "silent";
}

/** « à l'instant », « il y a 12 min »… ou « jamais ». */
export function seenLabel(iso: string | null, now = Date.now()): string {
  const at = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(at)) return "jamais";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "à l'instant";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}
