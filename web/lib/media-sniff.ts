/**
 * Type RÉEL d'un envoi : on lit les premiers octets du fichier et on vérifie qu'ils portent la signature
 * d'un conteneur audio ou vidéo que l'atelier accepte. L'extension et le type MIME déclarés par le
 * navigateur ne prouvent rien ; sans cette lecture, une page HTML, un exécutable ou une archive nommés
 * `.mp3` iraient jusqu'à ffprobe et ffmpeg (une grande surface d'attaque) avant d'être refusés.
 *
 * On ne juge pas ici que le fichier est LISIBLE (c'est le rôle de ffprobe, `media-probe.ts`) : on
 * écarte seulement ce qui n'est manifestement pas un média.
 */
export type Sniff =
  | { ok: true; family: string }
  | { ok: false; message: string };

/** Nombre d'octets à lire en tête de fichier. */
export const SNIFF_BYTES = 16;

const REFUSAL: Sniff = {
  ok: false,
  message:
    "Ce fichier n'est pas un audio ou une vidéo reconnu : son contenu ne correspond pas à son extension.",
};
const ascii = (buffer: Buffer, start: number, end: number): string =>
  buffer.subarray(start, end).toString("latin1");

export function sniffMedia(head: Buffer): Sniff {
  if (head.length < 4) return REFUSAL;
  if (ascii(head, 0, 3) === "ID3" && head.length >= 10)
    return { ok: true, family: "mp3" };
  if (head[0] === 0xff) {
    const b1 = head[1];
    // ADTS (AAC) : 0xFFF0 à 0xFFF1 / 0xFFF8 à 0xFFF9 ; trame MPEG audio : 0xFFE0 et plus, couche non nulle.
    if ((b1 & 0xf6) === 0xf0) return { ok: true, family: "aac" };
    if ((b1 & 0xe0) === 0xe0 && (b1 & 0x06) !== 0)
      return { ok: true, family: "mpeg-audio" };
    return REFUSAL;
  }
  if (ascii(head, 0, 4) === "RIFF" && head.length >= 12) {
    const kind = ascii(head, 8, 12);
    if (kind === "WAVE") return { ok: true, family: "wav" };
    if (kind === "AVI ") return { ok: true, family: "avi" };
    return REFUSAL;
  }
  if (ascii(head, 0, 4) === "OggS") return { ok: true, family: "ogg" };
  if (ascii(head, 0, 4) === "fLaC") return { ok: true, family: "flac" };
  if (head.length >= 12 && ascii(head, 4, 8) === "ftyp")
    return { ok: true, family: "isobmff" };
  if (
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  )
    return { ok: true, family: "matroska" };
  return REFUSAL;
}
