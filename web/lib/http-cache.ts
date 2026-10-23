/**
 * Validation de cache HTTP pour les fichiers dérivés d'une session (crêtes de la forme d'onde, 2,3 Mo
 * pour 2 h d'audio) : le navigateur redemande avec `If-None-Match` et le serveur répond `304` sans
 * renvoyer le corps tant que le fichier n'a pas changé. Fonctions pures.
 */

/** Étiquette faible dérivée de la taille et de la date de modification du fichier. */
export function weakEtag(size: number, mtimeMs: number): string {
  return `W/"${size}-${Math.floor(mtimeMs)}"`;
}

/** Vrai si `If-None-Match` désigne cette étiquette (faible ou forte, liste ou joker). */
export function matchesEtag(ifNoneMatch: string | null, etag: string): boolean {
  if (!ifNoneMatch) return false;
  const bare = (value: string) => value.trim().replace(/^W\//, "");
  return ifNoneMatch
    .split(",")
    .some(
      (candidate) => candidate.trim() === "*" || bare(candidate) === bare(etag),
    );
}
