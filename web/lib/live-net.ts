/**
 * Les deux appels réseau de l'écran « En direct » qui ne passent pas par le WebSocket :
 *  - le jeton de session (`POST /api/live/token`), un par départ et un par reprise ;
 *  - « Garder cet enregistrement » : l'envoi du son, comme un import classique, avec une VRAIE barre
 *    de transfert (un `fetch` ne donne pas la progression d'un envoi).
 * Les erreurs sont rendues en français lisible ; jamais un code brut.
 */
import type { SocketLike, TokenResult } from "./live-client";

const NETWORK =
  "Connexion au serveur impossible : vérifie le réseau puis réessaie.";

type Fetch = typeof fetch;

export async function fetchLiveToken(
  technical: boolean,
  doFetch: Fetch = fetch,
): Promise<TokenResult> {
  let response: Response;
  try {
    response = await doFetch("/api/live/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ technical }),
      cache: "no-store",
    });
  } catch {
    return { ok: false, status: 0, code: "network", message: NETWORK };
  }
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = await response.json();
    if (parsed && typeof parsed === "object")
      data = parsed as Record<string, unknown>;
  } catch {
    // corps absent ou illisible
  }
  if (
    response.ok &&
    typeof data.token === "string" &&
    typeof data.url === "string"
  )
    return {
      ok: true,
      token: data.token,
      url: data.url,
      technical: data.technical === true,
    };
  const retry = Number(response.headers.get("Retry-After"));
  return {
    ok: false,
    status: response.status,
    code:
      typeof data.code === "string"
        ? data.code
        : response.status === 401
          ? "unauthenticated"
          : "http",
    message: typeof data.error === "string" ? data.error : NETWORK,
    retryAfterS: Number.isFinite(retry) && retry > 0 ? retry : undefined,
  };
}

/** WebSocket du navigateur, vu par le client (`SocketLike`) ; les trames audio sont des octets. */
export function openBrowserSocket(url: string): SocketLike {
  const socket = new WebSocket(url);
  socket.binaryType = "arraybuffer";
  return socket as unknown as SocketLike;
}

// ───────────── Garder cet enregistrement ─────────────

export type KeepOptions = {
  visibility: "global" | "private";
  /** Nom de la session (1 à 120 caractères). */
  name: string;
};

export type XhrLike = {
  open(method: string, url: string): void;
  setRequestHeader(name: string, value: string): void;
  send(body: Blob): void;
  upload: {
    onprogress: ((event: { loaded: number; total: number }) => void) | null;
  };
  onload: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  status: number;
  responseText: string;
};

export function keepRecording(
  file: File,
  options: KeepOptions,
  onProgress: (fraction: number) => void,
  makeXhr: () => XhrLike = () => new XMLHttpRequest() as unknown as XhrLike,
): Promise<{ id: string; autorunError?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = makeXhr();
    xhr.open(
      "POST",
      `/api/sessions?autorun=1&visibility=${options.visibility}`,
    );
    xhr.setRequestHeader("x-aqr-filename", encodeURIComponent(file.name));
    xhr.setRequestHeader("x-aqr-source-kind", "microphone");
    xhr.setRequestHeader("x-aqr-name", encodeURIComponent(options.name));
    xhr.setRequestHeader(
      "content-type",
      file.type || "application/octet-stream",
    );
    xhr.upload.onprogress = (event) => {
      if (event.total > 0) onProgress(Math.min(1, event.loaded / event.total));
    };
    xhr.onerror = () => reject(new Error(NETWORK));
    xhr.onabort = () => reject(new Error("L’envoi a été interrompu."));
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(xhr.responseText);
        if (parsed && typeof parsed === "object")
          data = parsed as Record<string, unknown>;
      } catch {
        // corps illisible
      }
      if (
        xhr.status >= 200 &&
        xhr.status < 300 &&
        typeof data.id === "string"
      ) {
        onProgress(1);
        resolve({
          id: data.id,
          autorunError:
            typeof data.autorun_error === "string"
              ? data.autorun_error
              : undefined,
        });
        return;
      }
      reject(
        new Error(
          xhr.status === 401
            ? "Ta connexion à l’atelier a expiré : reconnecte-toi, l’enregistrement reste dans cette page."
            : typeof data.error === "string"
              ? data.error
              : "Le serveur a répondu par une erreur inattendue.",
        ),
      );
    };
    xhr.send(file);
  });
}
