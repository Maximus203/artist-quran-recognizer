/**
 * Les décisions prises hors ligne : gardées sur l'appareil (jamais perdues) et renvoyées dès que la
 * connexion revient. Un confort : tout accès au stockage est protégé, et ce qui est illisible est jeté.
 * Les opérations sont celles de `PUT …/decisions` ; le serveur relit tout et reste seul juge.
 */
import type { DecisionOp } from "./export-client";

const PREFIX = "aqr.ui.v1.export.draft.";
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): Store | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

const isOp = (value: unknown): value is DecisionOp =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { op?: unknown }).op === "string" &&
  ["decide", "withdraw", "consent", "training", "reattach"].includes(
    (value as { op: string }).op,
  );

export function pendingOps(
  sessionId: string,
  storage: Store | null = browserStorage(),
): DecisionOp[] {
  try {
    const raw = storage?.getItem(PREFIX + sessionId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOp).slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function queueOps(
  sessionId: string,
  ops: readonly DecisionOp[],
  storage: Store | null = browserStorage(),
): DecisionOp[] {
  const all = [...pendingOps(sessionId, storage), ...ops].slice(-50);
  try {
    storage?.setItem(PREFIX + sessionId, JSON.stringify(all));
  } catch {
    /* stockage plein ou bloqué : la décision n'est pas gardée, l'écran le dit */
  }
  return all;
}

export function clearOps(
  sessionId: string,
  storage: Store | null = browserStorage(),
): void {
  try {
    storage?.removeItem(PREFIX + sessionId);
  } catch {
    /* rien à faire */
  }
}
