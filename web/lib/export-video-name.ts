/**
 * Nom du fichier de la vidéo exportée : celui de l'audio de la session (sans son extension),
 * modifiable avant le téléchargement. Même nettoyage que les sous-titres : aucun séparateur de
 * chemin, de `..` ni de caractère de contrôle ; 120 caractères au plus.
 */
import { rangeLabel, type ExportRange } from "./export-video-ranges";

const MAX_NAME = 120;
const TAIL = ".mp4";

const clean = (value: string): string =>
  value
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, " ")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");

export function videoFileName(sessionName: string, custom?: string): string {
  const raw = custom?.trim()
    ? custom.replace(/\.mp4$/i, "")
    : sessionName.replace(/\.[A-Za-z0-9]{1,5}$/, "");
  const stem = clean(raw) || "video";
  return (
    Array.from(stem)
      .slice(0, MAX_NAME - TAIL.length)
      .join("") + TAIL
  );
}

/**
 * Nom du fichier d'une plage : le nom de base (saisi ou celui de l'audio) suivi de l'intervalle
 * (« ... 0m12s-0m40s.mp4 »). Un export entier, ou une plage unique avec un nom saisi, garde le nom tel quel.
 */
export function videoRangeFileName(
  sessionName: string,
  custom: string | undefined,
  range: ExportRange | null,
  total: number,
): string {
  const base = videoFileName(sessionName, custom);
  if (!range) return base;
  if (total === 1 && custom?.trim()) return base;
  return videoFileName(`${base.replace(/\.mp4$/i, "")} ${rangeLabel(range)}`);
}
