import { ApiError, api } from "./api-client";
import {
  checkClipDuration,
  checkClipFile,
  clipExplanation,
  DEFAULT_CLIP_LIMITS,
  type ClipCode,
  type ClipLimits,
} from "./background-video-policy";
import {
  chunkSender,
  INTERRUPTED,
  transient,
  type ChunkSender,
} from "./chunked-upload-client";

/**
 * Envoi de la vidéo de fond choisie (navigateur) : l'export est rendu sur le serveur, qui doit donc recevoir le
 * fichier. Contrôle d'abord (format, poids, durée : AVANT le moindre octet), puis envoi par morceaux (le moteur de
 * `chunked-upload-client.ts` : renvoi d'un morceau perdu, reprise), puis attente de la préparation du serveur.
 *
 * Une coupure de réseau ne perd rien : l'envoi reste sur le serveur et `resumeId` permet de reprendre en ne
 * renvoyant que ce qui manque. Toute erreur sort avec un code (`ClipCode`) et une phrase en français clair.
 */
export type ClipView = {
  id: string;
  name: string;
  state: "uploading" | "processing" | "ready" | "failed";
  size: number;
  ratio: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
  failure: ClipCode | null;
  message: string | null;
};

type StatusBody = ClipView & {
  chunk_size: number;
  chunks: number;
  received: number[];
};

export type ClipProgress = {
  /** « sending » : le fichier part ; « preparing » : le serveur prépare la copie de rendu. */
  phase: "sending" | "preparing";
  ratio: number;
};

export type ClipUploadIo = {
  onProgress?: (progress: ClipProgress) => void;
  signal?: AbortSignal;
  /** Morceaux envoyés en même temps (défaut 3). */
  parallel?: number;
  /** Nouveaux essais d'un morceau après un échec passager. */
  retries?: number;
  /** Attente entre deux essais ; injectable pour les tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Intervalle entre deux lectures de l'état de la préparation (ms, défaut 1000). */
  pollMs?: number;
  /** Durée lue par le navigateur (s) : une vidéo trop longue est refusée avant l'envoi. Absente : le serveur contrôle. */
  seconds?: number;
  /** Plafonds connus ; sinon lus sur le serveur. */
  limits?: ClipLimits;
  /** Envoi interrompu par une coupure : le reprendre (ne renvoie que les morceaux manquants). */
  resumeId?: string;
};

export class ClipUploadError extends Error {
  constructor(
    readonly code: ClipCode,
    message: string,
    /** Présent quand l'envoi est resté sur le serveur : à passer à `resumeId` pour reprendre. */
    readonly resumeId?: string,
  ) {
    super(message);
    this.name = "ClipUploadError";
  }
}

const KNOWN_CODES = new Set<string>([
  "format",
  "empty",
  "too_big",
  "too_long",
  "too_wide",
  "no_duration",
  "unreadable",
  "no_video",
  "network",
  "disk_full",
  "too_many",
  "missing",
  "session_missing",
  "not_ready",
  "interrupted",
  "server",
]);
const POLL_MISSES = 5;
const MAX_WAIT_MS = 30 * 60_000;

const baseOf = (sessionId: string) =>
  `/api/sessions/${sessionId}/background-videos`;

/** Les plafonds du serveur (pour les dire avant le choix du fichier) ; les valeurs par défaut si la lecture échoue. */
export async function fetchClipLimits(sessionId: string): Promise<ClipLimits> {
  try {
    const body = await api<{
      limits: { max_bytes: number; max_seconds: number; max_clips: number };
    }>(baseOf(sessionId));
    return {
      maxBytes: body.limits.max_bytes,
      maxSeconds: body.limits.max_seconds,
      maxClips: body.limits.max_clips,
    };
  } catch {
    return DEFAULT_CLIP_LIMITS;
  }
}

/** Retire la vidéo du serveur. Déjà disparue (expirée, supprimée) : ce n'est pas une erreur. */
export async function removeBackgroundVideo(
  sessionId: string,
  id: string,
): Promise<void> {
  try {
    await api(`${baseOf(sessionId)}/${id}`, { method: "DELETE" });
  } catch {
    /* le nettoyage du serveur (expiration) prendra le relais */
  }
}

/** La copie préparée par le serveur, en fichier (aperçu quand le navigateur ne lit pas l'original). */
export async function fetchPreparedClip(
  sessionId: string,
  id: string,
  name: string,
): Promise<File> {
  let response: Response;
  try {
    response = await fetch(`${baseOf(sessionId)}/${id}/file`, {
      credentials: "same-origin",
    });
  } catch {
    throw new ClipUploadError("network", clipExplanation("network", {}));
  }
  if (!response.ok)
    throw new ClipUploadError(
      response.status === 404 ? "missing" : "not_ready",
      clipExplanation(response.status === 404 ? "missing" : "not_ready", {}),
    );
  return new File([await response.blob()], name, { type: "video/mp4" });
}

const sleepOf = (io: ClipUploadIo) =>
  io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

function failure(error: unknown, resumeId: string | null): ClipUploadError {
  if (error instanceof ClipUploadError) return error;
  if (error instanceof Error && error.message === INTERRUPTED)
    return new ClipUploadError(
      "interrupted",
      clipExplanation("interrupted", {}),
    );
  if (error instanceof ApiError) {
    if (error.status === 0)
      return new ClipUploadError(
        "network",
        clipExplanation("network", {}),
        resumeId ?? undefined,
      );
    if (error.code && KNOWN_CODES.has(error.code))
      return new ClipUploadError(error.code as ClipCode, error.message);
    if (error.status === 404)
      return new ClipUploadError("missing", clipExplanation("missing", {}));
  }
  return new ClipUploadError("server", clipExplanation("server", {}));
}

/** Les erreurs où l'envoi reste sur le serveur, pour qu'on puisse reprendre. */
const resumable = (error: ClipUploadError) => error.resumeId !== undefined;

async function waitReady(
  base: string,
  io: ClipUploadIo,
  sleep: (ms: number) => Promise<void>,
): Promise<ClipView> {
  const poll = io.pollMs ?? 1000;
  const startedAt = Date.now();
  let misses = 0;
  for (;;) {
    if (io.signal?.aborted) throw new Error(INTERRUPTED);
    let status: StatusBody;
    try {
      status = await api<StatusBody>(base);
      misses = 0;
    } catch (error) {
      if (transient(error) && ++misses < POLL_MISSES) {
        await sleep(poll);
        continue;
      }
      throw error;
    }
    if (status.state === "ready") return status;
    if (status.state === "failed")
      throw new ClipUploadError(
        status.failure ?? "unreadable",
        status.message ?? clipExplanation(status.failure ?? "unreadable", {}),
      );
    io.onProgress?.({ phase: "preparing", ratio: status.ratio ?? 0 });
    if (Date.now() - startedAt > MAX_WAIT_MS)
      throw new ClipUploadError("server", clipExplanation("server", {}));
    await sleep(poll);
  }
}

/**
 * Juste avant un export : la vidéo choisie est-elle toujours prête sur le serveur ? Prête : rien à faire. En
 * préparation : on attend la fin. Disparue (expirée, supprimée) ou échouée : on la renvoie depuis le fichier que
 * l'écran garde (nouvel identifiant : le parent met sa valeur à jour). Lève `ClipUploadError`.
 */
export async function ensureClipOnServer(
  sessionId: string,
  clip: { uploadId: string; file: File },
  io: ClipUploadIo = {},
): Promise<ClipView> {
  const base = `${baseOf(sessionId)}/${clip.uploadId}`;
  let state: StatusBody | null = null;
  try {
    state = await api<StatusBody>(base);
  } catch (error) {
    if (!(error instanceof ApiError && error.status === 404))
      throw failure(error, null);
  }
  if (state?.state === "ready") return state;
  if (state?.state === "processing") {
    try {
      return await waitReady(base, io, sleepOf(io));
    } catch (error) {
      throw failure(error, clip.uploadId);
    }
  }
  if (state) await removeBackgroundVideo(sessionId, clip.uploadId); // envoi échoué ou resté en route
  return uploadBackgroundVideo(sessionId, clip.file, io);
}

/**
 * Envoie la vidéo, attend sa préparation et rend son état « prêt ». Lève `ClipUploadError`. Sur un refus, une
 * annulation ou un échec de préparation, ce qui est resté sur le serveur est supprimé ; sur une coupure de réseau,
 * il est GARDÉ (voir `resumeId`).
 */
export async function uploadBackgroundVideo(
  sessionId: string,
  file: File,
  io: ClipUploadIo = {},
): Promise<ClipView> {
  const base = baseOf(sessionId);
  const sleep = sleepOf(io);
  const limits = io.limits ?? (await fetchClipLimits(sessionId));
  // Les contrôles qu'on peut faire sans serveur : avant le moindre octet.
  const refused =
    checkClipFile(file, limits) ??
    (io.seconds === undefined ? null : checkClipDuration(io.seconds, limits));
  if (refused) throw new ClipUploadError(refused.code, refused.message);
  if (io.signal?.aborted)
    throw new ClipUploadError(
      "interrupted",
      clipExplanation("interrupted", {}),
    );

  let id: string | null = io.resumeId ?? null;
  let sender: ChunkSender | null = null;
  const sending = {
    ...io,
    onProgress: (ratio: number) => io.onProgress?.({ phase: "sending", ratio }),
  };
  try {
    let plan: {
      chunk_size: number;
      chunks: number;
      received: number[];
    } | null = null;
    let state: ClipView["state"] = "uploading";
    if (id) {
      try {
        const status = await api<StatusBody>(`${base}/${id}`);
        plan = status;
        state = status.state;
      } catch (error) {
        // Le serveur ne la connaît plus (expirée, supprimée) : on repart d'un envoi neuf.
        if (!(error instanceof ApiError) || error.status !== 404) throw error;
        id = null;
      }
    }
    if (!id || !plan) {
      const created = await api<{
        id: string;
        chunk_size: number;
        chunks: number;
      }>(base, {
        method: "POST",
        json: { filename: file.name, size: file.size },
      });
      id = created.id;
      plan = { ...created, received: [] };
      state = "uploading";
    }
    const own = `${base}/${id}`;
    if (state === "uploading") {
      sender = chunkSender(file, plan, own, sending);
      const have = new Set(plan.received);
      await sender.sendAll(
        Array.from({ length: plan.chunks }, (_, i) => i).filter(
          (i) => !have.has(i),
        ),
      );
      await sender.complete({});
      io.onProgress?.({ phase: "sending", ratio: 1 });
    }
    return await waitReady(own, io, sleep);
  } catch (error) {
    const known = failure(error, id);
    // Une coupure garde l'envoi pour reprendre ; tout le reste le supprime du serveur.
    if (id && !resumable(known)) await removeBackgroundVideo(sessionId, id);
    throw known;
  }
}
