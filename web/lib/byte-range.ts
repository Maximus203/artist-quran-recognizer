/**
 * Lecture d'un en-tête `Range: bytes=…` (un seul intervalle). Sans lui un navigateur ne peut pas
 * se positionner dans une vidéo : `currentTime` reste à 0 et l'export ne verrait qu'une image.
 */
export type ByteRange =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

export function parseByteRange(header: string | null, size: number): ByteRange {
  if (!header) return { kind: "full" };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) return { kind: "full" };
  let start: number;
  let end: number;
  if (match[1] === "") {
    // Suffixe : les N derniers octets.
    const length = Number(match[2]);
    if (length === 0) return { kind: "unsatisfiable" };
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(size - 1, Number(match[2]));
  }
  if (start >= size || start > end) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end };
}
