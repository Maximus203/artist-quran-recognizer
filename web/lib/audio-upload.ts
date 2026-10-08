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
export const audioAccept = [...acceptedAudioExtensions].join(",");
const audioFormats = [...acceptedAudioExtensions]
  .map((extension) => extension.slice(1).toUpperCase())
  .join(", ");

export function isAcceptedAudioName(name: string): boolean {
  const dot = name.lastIndexOf(".");
  return dot >= 0 && acceptedAudioExtensions.has(name.slice(dot).toLowerCase());
}

export function firstAcceptedAudio<T extends { name: string }>(
  files: Iterable<T>,
): T | null {
  for (const file of files) if (isAcceptedAudioName(file.name)) return file;
  return null;
}

export function bindAudioDrop(
  target: EventTarget,
  handlers: {
    onActive: (active: boolean) => void;
    onAudio: (file: File) => void;
    onError: (message: string) => void;
  },
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
    const selected = firstAcceptedAudio(
      Array.from((event as DragEvent).dataTransfer?.files || []),
    );
    if (selected) handlers.onAudio(selected);
    else
      handlers.onError(
        `Aucun audio compatible dans le dépôt (${audioFormats}).`,
      );
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
