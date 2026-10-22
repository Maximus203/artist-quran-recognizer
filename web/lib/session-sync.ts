import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db";
import { log } from "./log";
import {
  createMeta,
  deleteMeta,
  getMeta,
  knownIds,
  recordAnalysis,
  setDerived,
  syncMirror,
} from "./session-index";
import { contentLabel, defaultSessionName } from "./session-name";
import { isSessionId } from "./session-id";
import {
  backfillDerived,
  readResult,
  readSession,
  reviewRoot,
  sessionDir,
  sessionHooks,
  type Session,
} from "./store";

/**
 * Pont entre le disque (source de vérité de l'état d'une analyse) et l'index SQLite : chaque
 * écriture de `session.json` met l'index à jour, et à la fin d'une analyse on calcule ce qui coûte
 * un parcours de fichiers (taille du dossier, étiquette de contenu) une seule fois.
 */
const TERMINAL = new Set<Session["state"]>(["done", "failed"]);

/** Taille de tout un dossier de session, sans suivre les liens symboliques. */
export async function directoryBytes(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) total += await directoryBytes(full);
      else if (entry.isFile()) total += (await lstat(full)).size;
    } catch (error) {
      // Fichier renommé ou supprimé pendant le parcours (écriture atomique) : ignoré.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return total;
}

const timeZone = () => process.env.AQR_TIMEZONE || undefined;

export async function syncSession(session: Session): Promise<void> {
  const db = getDb();
  const previous = getMeta(db, session.id);
  if (!previous)
    // Session sans propriétaire connu (créée avant les comptes ou hors de l'atelier) : globale.
    createMeta(db, {
      id: session.id,
      ownerId: null,
      name: defaultSessionName(
        session.name,
        session.created_at,
        session.source_kind ?? "file",
        timeZone(),
      ),
      nameSource: "auto",
      originalName: session.name,
      sourceKind: session.source_kind ?? "file",
      visibility: "global",
      createdAt: session.created_at,
      sizeBytes: session.size,
    });
  syncMirror(db, session, new Date().toISOString());
  const arrived =
    TERMINAL.has(session.state) && (!previous || !TERMINAL.has(previous.state));
  if (!arrived) return;
  const meta = getMeta(db, session.id);
  let label: string | null = null;
  if (session.state === "done") {
    try {
      const result = await readResult(session.id);
      label = result ? contentLabel(result.parsed) : null;
    } catch (error) {
      log.warn(
        "index",
        "étiquette de contenu impossible (résultat illisible)",
        error,
      );
    }
  }
  let diskBytes: number | undefined;
  try {
    diskBytes = await directoryBytes(sessionDir(session.id));
  } catch (error) {
    log.warn("index", "taille du dossier de session illisible", error);
  }
  setDerived(db, session.id, { diskBytes, contentLabel: label });
  recordAnalysis(db, session, meta?.owner_id ?? null);
}

/**
 * Premier démarrage avec des sessions déjà sur le disque : chacune entre dans l'index (sans
 * propriétaire, portée globale, nom par défaut dérivé du nom de fichier, taille mesurée). Seules
 * les sessions absentes de l'index sont traitées : le passage est idempotent et bon marché.
 */
export async function importLegacySessions(): Promise<number> {
  const db = getDb();
  let ids: string[];
  try {
    ids = await readdir(path.join(reviewRoot(), "sessions"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  const known = knownIds(db);
  let imported = 0;
  for (const id of ids) {
    if (!isSessionId(id) || known.has(id)) continue;
    try {
      const session = await backfillDerived(await readSession(id));
      await syncSession(session);
      imported += 1;
    } catch (error) {
      log.warn("index", `session ${id} ignorée à l'import (illisible)`, error);
    }
  }
  if (imported > 0)
    log.info(
      "index",
      `${imported} session(s) existante(s) importée(s) dans la base`,
    );
  return imported;
}

/** Branche l'index sur les écritures de `store.ts`. */
export function installSessionHooks(): void {
  sessionHooks.saved = syncSession;
  sessionHooks.removed = (id) => deleteMeta(getDb(), id);
}
