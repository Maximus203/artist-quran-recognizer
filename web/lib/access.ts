/**
 * Autorisations : fonctions PURES, une seule table de règles pour toutes les routes de session.
 *
 *  - voir (lister, lire, écouter, exporter, signaler) : portée `global`, ou propriétaire, ou
 *    administrateur. L'administrateur voit TOUTES les sessions, privées d'autrui comprises : il
 *    régule le stockage et prévient les testeurs. Un testeur ne voit jamais le privé d'un autre ;
 *    il répond alors 404 (pas 403) pour ne pas révéler l'existence de la session ;
 *  - modifier (renommer, portée, archiver, supprimer, lancer ou annuler) : le propriétaire ou un
 *    administrateur, parmi les sessions qu'on peut voir. Une session d'avant les comptes
 *    (`owner_id` nul) n'a pas de propriétaire : seuls les administrateurs la modifient ;
 *  - vérité terrain (écriture dans le manifeste de test) : administrateurs, sur une session visible.
 */
export type Visibility = "global" | "private";
export type Actor = { id: number; role: "user" | "admin" };
export type Resource = { owner_id: number | null; visibility: Visibility };

export type Ability =
  | "view"
  | "review"
  | "favorite"
  | "edit"
  | "run"
  | "delete"
  | "truth";

export const isOwner = (actor: Actor, meta: Resource): boolean =>
  meta.owner_id !== null && meta.owner_id === actor.id;

export const isAdmin = (actor: Actor): boolean => actor.role === "admin";

export function canView(actor: Actor, meta: Resource): boolean {
  return meta.visibility === "global" || isOwner(actor, meta) || isAdmin(actor);
}

export function can(actor: Actor, ability: Ability, meta: Resource): boolean {
  if (!canView(actor, meta)) return false;
  switch (ability) {
    case "view":
    case "review":
    case "favorite":
      return true;
    case "edit":
    case "run":
    case "delete":
      return isAdmin(actor) || isOwner(actor, meta);
    case "truth":
      return isAdmin(actor);
  }
}

/** Résultat d'un contrôle : « absent » = 404 (invisible ou inexistant), « interdit » = 403. */
export type Decision = "ok" | "absent" | "forbidden";

export function decide(
  actor: Actor,
  ability: Ability,
  meta: Resource | null,
): Decision {
  if (!meta || !canView(actor, meta)) return "absent";
  return can(actor, ability, meta) ? "ok" : "forbidden";
}
