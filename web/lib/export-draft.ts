/**
 * Les décisions prises hors ligne : gardées sur l'appareil (jamais perdues) et renvoyées dès que la
 * connexion revient. Elles sont rangées PAR COMPTE : deux personnes qui partagent un navigateur ne
 * relisent jamais les décisions de l'autre. Un confort : tout accès au stockage est protégé, et ce qui
 * est illisible est jeté. Les opérations sont celles de `PUT …/decisions` ; le serveur relit tout et
 * reste seul juge.
 */
import type { DecisionOp } from "./export-client";

const PREFIX = "aqr.ui.v2.export.draft.";
/** Ancien format (une seule file par appareil, sans compte) : repris une fois par le compte suivant. */
const LEGACY_PREFIX = "aqr.ui.v1.export.draft.";
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

const keyOf = (owner: number, sessionId: string) =>
  `${PREFIX}${owner}.${sessionId}`;

function readOps(raw: string | null | undefined): DecisionOp[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isOp).slice(0, 50) : [];
  } catch {
    return [];
  }
}

/**
 * Reprend l'ancienne file (sans compte) pour le compte qui l'ouvre en premier, puis la supprime : rien
 * de ce qui était en attente n'est perdu à la mise à jour.
 */
function takeLegacyOps(
  owner: number,
  sessionId: string,
  storage: Store | null,
): void {
  try {
    const legacy = storage?.getItem(LEGACY_PREFIX + sessionId);
    if (!legacy) return;
    const ops = readOps(legacy);
    storage?.removeItem(LEGACY_PREFIX + sessionId);
    if (ops.length > 0)
      storage?.setItem(keyOf(owner, sessionId), JSON.stringify(ops));
  } catch {
    /* stockage bloqué : rien à reprendre */
  }
}

export function pendingOps(
  owner: number,
  sessionId: string,
  storage: Store | null = browserStorage(),
): DecisionOp[] {
  try {
    takeLegacyOps(owner, sessionId, storage);
    return readOps(storage?.getItem(keyOf(owner, sessionId)));
  } catch {
    return [];
  }
}

export function queueOps(
  owner: number,
  sessionId: string,
  ops: readonly DecisionOp[],
  storage: Store | null = browserStorage(),
): DecisionOp[] {
  const all = [...pendingOps(owner, sessionId, storage), ...ops].slice(-50);
  try {
    storage?.setItem(keyOf(owner, sessionId), JSON.stringify(all));
  } catch {
    /* stockage plein ou bloqué : la décision n'est pas gardée, l'écran le dit */
  }
  return all;
}

export function clearOps(
  owner: number,
  sessionId: string,
  storage: Store | null = browserStorage(),
): void {
  try {
    storage?.removeItem(keyOf(owner, sessionId));
  } catch {
    /* rien à faire */
  }
}
