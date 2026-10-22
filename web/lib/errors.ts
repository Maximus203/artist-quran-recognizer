/**
 * Erreurs montrées à l'utilisateur : jamais un chemin local ni un code système brut.
 * Une erreur de disque (`ENOENT: no such file or directory, open 'C:\\Users\\…\\session.json'`)
 * dit où vivent les données de la machine et ne dit rien d'utile ; on la traduit.
 */

const errnoCode = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^E[A-Z0-9]+$/.test(code) ? code : null;
};

/** La session (ou son dossier) n'existe pas : fichier absent, ou identifiant qui n'est pas un UUID. */
export function isMissingSession(error: unknown): boolean {
  return (
    errnoCode(error) === "ENOENT" ||
    (error instanceof Error && error.message === "Identifiant invalide")
  );
}

/** Texte à consigner dans `session.error` quand une analyse n'a pas pu démarrer ou finir. */
export function describeFailure(error: unknown, fallback = "Échec"): string {
  const code = errnoCode(error);
  if (code === "ENOENT")
    return "Fichier introuvable sur le disque (session incomplète ou supprimée).";
  if (code) return `Erreur disque (${code}).`;
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Code HTTP et message d'une réponse d'erreur d'API pour une session. */
export function httpError(
  error: unknown,
  fallback: string,
): { status: number; message: string } {
  if (isMissingSession(error))
    return { status: 404, message: "Session introuvable" };
  const code = errnoCode(error);
  if (code) return { status: 500, message: `Erreur disque (${code}).` };
  return {
    status: 400,
    message: error instanceof Error && error.message ? error.message : fallback,
  };
}
