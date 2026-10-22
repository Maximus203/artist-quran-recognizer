/**
 * Droits sur les signalements, côté navigateur. Le serveur reste juge (`review-update.ts` renvoie
 * `rejected`) ; ces fonctions ne servent qu'à NE PAS proposer une action qui serait refusée.
 * La règle est la même : l'auteur ou un administrateur, comparaison exacte du pseudonyme.
 */
export type Me = { username: string; admin: boolean };

export const canModifyAnnotation = (
  annotation: { tester: string },
  me: Me,
): boolean => me.admin || annotation.tester === me.username;

/** Message quand le serveur a refusé des modifications (`rejected` de la réponse du `PUT`). */
export function rejectedMessage(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 signalement n’a pas été modifié : il appartient à un autre testeur."
    : `${count} signalements n’ont pas été modifiés : ils appartiennent à un autre testeur.`;
}
