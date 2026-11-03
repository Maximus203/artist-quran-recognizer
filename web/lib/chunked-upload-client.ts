import { ApiError, api } from "./api-client";

/**
 * Envoi d'un fichier par morceaux (navigateur). Chaque morceau est une requête courte : sur une connexion lente
 * (4G), aucune requête ne dépasse le délai de lecture du proxy, et un morceau perdu se renvoie seul, sans
 * recommencer le fichier. Le serveur (`/api/uploads`) assemble et applique les contrôles de l'envoi unique.
 */
export const SMALL_UPLOAD_BYTES = 2 * 1024 * 1024; // en dessous : une seule requête suffit
const DEFAULT_PARALLEL = 3;
const DEFAULT_RETRIES = 6;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 15_000;
const INTERRUPTED = "L’envoi a été interrompu.";

export type ChunkedOptions = {
  visibility: "global" | "private";
  sourceKind: "file" | "microphone";
  /** Nom de la session ; sans lui, un nom par défaut est dérivé du fichier. */
  name?: string;
  /** Mettre l'analyse en file dès l'envoi (défaut : oui). */
  autorun?: boolean;
};

export type ChunkedIo = {
  /** Fraction envoyée, de 0 à 1 (1 seulement une fois la session créée). */
  onProgress?: (fraction: number) => void;
  /** Morceaux envoyés en même temps (défaut 3). */
  parallel?: number;
  /** Nouveaux essais d'un morceau après un échec passager (défaut 6). */
  retries?: number;
  signal?: AbortSignal;
  /** Attente entre deux essais ; injectable pour les tests. */
  sleep?: (ms: number) => Promise<void>;
};

type Created = { id: string; chunk_size: number; chunks: number };
type Finished = { id: string; autorun_error?: string };

/** Attente avant le n-ième nouvel essai : 0,5 s, 1 s, 2 s… bornée à 15 s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

/** Échec qui peut passer : réseau coupé, serveur occupé ou en panne ; jamais un refus (quota, type, restreint). */
function transient(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 0 || error.status === 408 || error.status === 429)
    return true;
  if (error.status >= 500) return error.code !== "restricted";
  return false;
}

export async function uploadInChunks(
  file: File,
  options: ChunkedOptions,
  io: ChunkedIo = {},
): Promise<{ id: string; autorunError?: string }> {
  const sleep =
    io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = io.retries ?? DEFAULT_RETRIES;
  const parallel = Math.max(1, io.parallel ?? DEFAULT_PARALLEL);
  const interrupted = () => io.signal?.aborted === true;
  if (interrupted()) throw new Error(INTERRUPTED);

  const created = await api<Created>("/api/uploads", {
    method: "POST",
    json: {
      filename: file.name,
      size: file.size,
      source_kind: options.sourceKind,
      visibility: options.visibility,
      ...(options.name ? { name: options.name } : {}),
      autorun: options.autorun ?? true,
    },
  });
  const base = `/api/uploads/${created.id}`;
  const done = new Set<number>();
  const report = () =>
    io.onProgress?.(Math.min(0.99, done.size / Math.max(1, created.chunks)));

  const sendChunk = async (index: number) => {
    const start = index * created.chunk_size;
    const body = file.slice(
      start,
      Math.min(file.size, start + created.chunk_size),
    );
    for (let attempt = 0; ; attempt++) {
      if (interrupted()) throw new Error(INTERRUPTED);
      try {
        await api(`${base}/chunks/${index}`, {
          method: "PUT",
          headers: { "content-type": "application/octet-stream" },
          body,
        });
        done.add(index);
        report();
        return;
      } catch (error) {
        if (!transient(error) || attempt >= retries) throw error;
        await sleep(retryDelayMs(attempt));
      }
    }
  };

  /** Envoie les morceaux demandés, `parallel` à la fois ; au premier échec définitif, plus aucun n'est lancé. */
  const sendAll = async (indexes: number[]) => {
    const queue = [...indexes];
    let failure: unknown = null;
    const worker = async () => {
      while (failure === null && queue.length > 0) {
        const index = queue.shift() as number;
        try {
          await sendChunk(index);
        } catch (error) {
          failure ??= error;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(parallel, indexes.length) }, worker),
    );
    if (failure !== null) throw failure;
  };

  const abandon = () => api(base, { method: "DELETE" }).catch(() => undefined);

  try {
    await sendAll(Array.from({ length: created.chunks }, (_, i) => i));
    let finished: Finished | null = null;
    for (let round = 0; finished === null; round++) {
      if (interrupted()) throw new Error(INTERRUPTED);
      try {
        finished = await api<Finished>(`${base}/complete`, {
          method: "POST",
          json: {},
        });
      } catch (error) {
        // Il manque des morceaux (réponse perdue, morceau écarté) : le serveur dit lesquels, on les renvoie.
        if (!(error instanceof ApiError) || error.status !== 409 || round >= 2)
          throw error;
        const state = await api<{ received: number[]; chunks: number }>(base);
        const have = new Set(state.received);
        have.forEach((i) => done.add(i));
        await sendAll(
          Array.from({ length: state.chunks }, (_, i) => i).filter(
            (i) => !have.has(i),
          ),
        );
      }
    }
    io.onProgress?.(1);
    return { id: finished.id, autorunError: finished.autorun_error };
  } catch (error) {
    await abandon();
    throw error;
  }
}
