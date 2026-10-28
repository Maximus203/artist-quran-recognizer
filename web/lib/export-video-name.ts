/**
 * Nom du fichier de la vidéo exportée : celui de l'audio de la session (sans son extension),
 * modifiable avant le téléchargement. Même nettoyage que les sous-titres : aucun séparateur de
 * chemin, de `..` ni de caractère de contrôle ; 120 caractères au plus.
 */
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
