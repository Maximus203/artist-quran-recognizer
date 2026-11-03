export const acceptedAudioExtensions = new Set([
  ".mp3",
  ".m4a",
  ".wav",
  ".ogg",
  ".opus",
  ".flac",
  ".aac",
  ".webm",
]);
/**
 * Conteneurs vidéo : le moteur en extrait la piste audio par ffmpeg (`-vn`). `.webm` reste classé
 * audio (c'est le format d'un enregistrement micro) mais accepte aussi une vidéo.
 */
export const acceptedVideoExtensions = new Set([
  ".mp4",
  ".mkv",
  ".mov",
  ".avi",
  ".m4v",
]);
export const acceptedMediaExtensions = new Set([
  ...acceptedAudioExtensions,
  ...acceptedVideoExtensions,
]);
export const audioAccept = [...acceptedAudioExtensions].join(",");
export const mediaAccept = [...acceptedMediaExtensions].join(",");
const formatNames = (extensions: Iterable<string>) =>
  [...extensions]
    .map((extension) => extension.slice(1).toUpperCase())
    .join(", ");
const audioFormats = formatNames(acceptedAudioExtensions);
const mediaFormats = formatNames(acceptedMediaExtensions);

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
};

export function isAcceptedAudioName(name: string): boolean {
  return acceptedAudioExtensions.has(extensionOf(name));
}
/** Audio ou vidéo : tout ce que l'atelier sait analyser. */
export function isAcceptedMediaName(name: string): boolean {
  return acceptedMediaExtensions.has(extensionOf(name));
}
/** Conteneur vidéo seulement (plafond d'envoi et contrôle de la piste audio propres à la vidéo). */
export function isVideoName(name: string): boolean {
  return acceptedVideoExtensions.has(extensionOf(name));
}

export function firstAcceptedAudio<T extends { name: string }>(
  files: Iterable<T>,
): T | null {
  for (const file of files) if (isAcceptedAudioName(file.name)) return file;
  return null;
}
/** Tous les audios et vidéos d'une sélection ou d'un dépôt multiple, dans l'ordre. */
export function acceptedMediaFiles<T extends { name: string }>(
  files: Iterable<T>,
): T[] {
  return Array.from(files).filter((file) => isAcceptedMediaName(file.name));
}

type DropHandlers = {
  onActive: (active: boolean) => void;
  onError: (message: string) => void;
};

/** Écoute un dépôt de fichiers sur `target` ; `onFiles` reçoit les fichiers déposés, ou une erreur. */
function bindFileDrop(
  target: EventTarget,
  handlers: DropHandlers,
  accept: (files: File[]) => void,
): () => void {
  let depth = 0;
  const hasFiles = (event: Event) =>
    Array.from((event as DragEvent).dataTransfer?.types || []).includes(
      "Files",
    );
  const enter = (event: Event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth += 1;
    handlers.onActive(true);
  };
  const over = (event: Event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    const transfer = (event as DragEvent).dataTransfer;
    if (transfer) transfer.dropEffect = "copy";
  };
  const leave = (event: Event) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) handlers.onActive(false);
  };
  const reset = () => {
    depth = 0;
    handlers.onActive(false);
  };
  const drop = (event: Event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    reset();
    accept(Array.from((event as DragEvent).dataTransfer?.files || []));
  };
  target.addEventListener("dragenter", enter);
  target.addEventListener("dragover", over);
  target.addEventListener("dragleave", leave);
  target.addEventListener("drop", drop);
  target.addEventListener("dragend", reset);
  target.addEventListener("blur", reset);
  return () => {
    target.removeEventListener("dragenter", enter);
    target.removeEventListener("dragover", over);
    target.removeEventListener("dragleave", leave);
    target.removeEventListener("drop", drop);
    target.removeEventListener("dragend", reset);
    target.removeEventListener("blur", reset);
  };
}

/** Dépôt d'un seul audio (comportement historique : le premier audio compatible). */
export function bindAudioDrop(
  target: EventTarget,
  handlers: DropHandlers & { onAudio: (file: File) => void },
): () => void {
  return bindFileDrop(target, handlers, (files) => {
    const selected = firstAcceptedAudio(files);
    if (selected) handlers.onAudio(selected);
    else
      handlers.onError(
        `Aucun audio compatible dans le dépôt (${audioFormats}).`,
      );
  });
}

/** Dépôt multiple d'audios et de vidéos : tous les médias compatibles, en une fois. */
export function bindMediaDrop(
  target: EventTarget,
  handlers: DropHandlers & { onFiles: (files: File[]) => void },
): () => void {
  return bindFileDrop(target, handlers, (files) => {
    const selected = acceptedMediaFiles(files);
    if (selected.length > 0) handlers.onFiles(selected);
    else
      handlers.onError(
        `Aucun audio ou vidéo compatible dans le dépôt (${mediaFormats}).`,
      );
  });
}
