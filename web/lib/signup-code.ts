import type { SignupMode } from "./auth";

/**
 * Le code d'invitation est demandé dès que l'inscription est en mode « code », premier compte compris :
 * c'est la règle du serveur (`registerAccount`). Seul le mode « fermé » laisse passer l'amorçage du tout premier
 * compte sans code, et il n'en demande à personne. Le formulaire s'appuie sur cette fonction pour ne jamais
 * diverger du serveur.
 */
export function codeRequired(
  mode: SignupMode,
  _firstAccount: boolean,
): boolean {
  return mode === "code";
}
