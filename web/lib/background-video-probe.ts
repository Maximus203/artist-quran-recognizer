import type { ClipCode } from "./background-video-policy";

/**
 * Ce que le navigateur de l'appareil sait d'une vidéo choisie (durée, taille) et ses vignettes pour la bande
 * « film ». Aucune lecture complète : un élément `<video>` en `preload="metadata"` sur le fichier local (jamais
 * chargé en mémoire), et quelques déplacements pour les vignettes. Les éléments du navigateur sont injectés :
 * testable sans lui.
 *
 * Un fichier que CE navigateur ne lit pas (HEVC d'un téléphone sur un ordinateur, MKV, AVI…) n'est pas un refus :
 * le serveur sait le lire et en fait une copie ; l'appelant décide.
 */
export type VideoFacts = { duration: number; width: number; height: number };

export class ProbeError extends Error {
  constructor(
    readonly code: Extract<ClipCode, "unreadable" | "no_video" | "no_duration">,
  ) {
    super(code);
    this.name = "ProbeError";
  }
}

export type ProbeDeps = {
  createVideo: () => HTMLVideoElement;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
  /** Attente maximale d'un événement (ms). */
  timeoutMs: number;
  /** Surface de dessin des vignettes. */
  createCanvas?: () => HTMLCanvasElement;
};

export const browserProbeDeps = (): ProbeDeps => ({
  createVideo: () => document.createElement("video"),
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  // Un fichier dont l'index est en fin (caméra, long film) se lit plus lentement sur un téléphone.
  timeoutMs: 20_000,
  createCanvas: () => document.createElement("canvas"),
});

/** Attend `ok` (ou `bad`) sur l'élément ; `start` est lancé APRÈS la pose des écouteurs. */
function waitFor(
  video: HTMLVideoElement,
  ok: string,
  bad: string | null,
  timeoutMs: number,
  start: () => void,
): Promise<"ok" | "bad" | "timeout"> {
  return new Promise((resolve) => {
    const finish = (result: "ok" | "bad" | "timeout") => {
      clearTimeout(timer);
      video.removeEventListener(ok, onOk);
      if (bad) video.removeEventListener(bad, onBad);
      resolve(result);
    };
    const onOk = () => finish("ok");
    const onBad = () => finish("bad");
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    video.addEventListener(ok, onOk);
    if (bad) video.addEventListener(bad, onBad);
    start();
  });
}

/** Un élément `<video>` prêt, métadonnées lues ; `null` si elles n'arrivent pas. Le fichier est libéré par `release`. */
async function openVideo(file: Blob, deps: ProbeDeps) {
  const url = deps.createObjectUrl(file);
  const video = deps.createVideo();
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  const release = () => {
    video.removeAttribute("src");
    video.load();
    deps.revokeObjectUrl(url);
  };
  const outcome = await waitFor(
    video,
    "loadedmetadata",
    "error",
    deps.timeoutMs,
    () => {
      video.src = url;
    },
  );
  return { video, release, ready: outcome === "ok" };
}

/** Un WebM enregistré annonce une durée infinie : aller à la fin force le navigateur à la calculer. */
async function settleDuration(video: HTMLVideoElement, timeoutMs: number) {
  if (Number.isFinite(video.duration)) return;
  await waitFor(video, "durationchange", null, timeoutMs, () => {
    video.currentTime = 1e101;
  });
}

export async function readVideoFacts(
  file: Blob,
  deps: ProbeDeps = browserProbeDeps(),
): Promise<VideoFacts> {
  const { video, release, ready } = await openVideo(file, deps);
  try {
    if (!ready) throw new ProbeError("unreadable");
    // Un son seul (ou une vidéo sans piste image) n'a pas de dimensions.
    if (!(video.videoWidth > 0 && video.videoHeight > 0))
      throw new ProbeError("no_video");
    await settleDuration(video, deps.timeoutMs);
    const { duration } = video;
    if (!Number.isFinite(duration) || !(duration > 0))
      throw new ProbeError("no_duration");
    return { duration, width: video.videoWidth, height: video.videoHeight };
  } finally {
    release();
  }
}

const THUMB_HEIGHT = 96;
const THUMB_QUALITY = 0.6;

/**
 * `count` vignettes à intervalles réguliers (au milieu de chaque case), prises l'une après l'autre. `onFrame` reçoit
 * chaque vignette dès qu'elle est prête (la bande se remplit au fur et à mesure) ; un déplacement qui n'aboutit pas
 * laisse sa case vide. Une vidéo illisible donne des cases vides, sans erreur : la bande reste hachurée.
 */
export async function captureFilmFrames(
  file: Blob,
  count: number,
  options: {
    deps?: ProbeDeps;
    signal?: AbortSignal;
    onFrame?: (index: number, url: string | null) => void;
  } = {},
): Promise<Array<string | null>> {
  const deps = options.deps ?? browserProbeDeps();
  const frames: Array<string | null> = Array.from(
    { length: count },
    () => null,
  );
  const { video, release, ready } = await openVideo(file, deps);
  try {
    if (!ready || options.signal?.aborted) return frames;
    await settleDuration(video, deps.timeoutMs);
    const { duration } = video;
    const canvas = deps.createCanvas?.();
    if (!canvas || !Number.isFinite(duration) || !(duration > 0)) return frames;
    const ratio =
      video.videoWidth > 0 ? video.videoWidth / video.videoHeight : 16 / 9;
    canvas.height = THUMB_HEIGHT;
    canvas.width = Math.max(1, Math.round(THUMB_HEIGHT * ratio));
    const context = canvas.getContext("2d");
    if (!context) return frames;
    for (let index = 0; index < count; index++) {
      if (options.signal?.aborted) break;
      const outcome = await waitFor(
        video,
        "seeked",
        null,
        deps.timeoutMs,
        () => {
          video.currentTime = ((index + 0.5) / count) * duration;
        },
      );
      if (options.signal?.aborted) break;
      if (outcome === "ok") {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        frames[index] = canvas.toDataURL("image/jpeg", THUMB_QUALITY);
      }
      options.onFrame?.(index, frames[index]);
    }
    return frames;
  } finally {
    release();
  }
}
