/**
 * Valeurs de sécurité exigées au démarrage en production (docs/SECURITE-PRE-DEPLOIEMENT.md §13).
 * Un serveur qui démarre sans clé, sans mode d'accès déclaré ou avec une origine publique mal
 * formée ne protège rien sans que personne ne le voie : en production il refuse de démarrer, en
 * développement il prévient seulement. Aucune valeur n'est jamais citée dans les messages.
 *
 * Deux modes d'accès, déclarés sans ambiguïté :
 *  - local : `AQR_LOCAL_ONLY=1` (poste de travail, aucun jeton, seul 127.0.0.1 est accepté) ;
 *  - public : `AQR_ACCESS_TOKEN` + `AQR_PUBLIC_ORIGIN` (https) + `AQR_TRUST_PROXY` explicite.
 */
export type ConfigProblem = { variable: string; message: string };

type Env = Record<string, string | undefined>;

const MIN_SECRET = 32;
const WEAK = new Set([
  "aqr-audit",
  "changeme",
  "change-me",
  "password",
  "secret",
  "test",
  "dev",
  "token",
]);

const blank = (value: string | undefined): boolean =>
  value === undefined || value.trim() === "";

function secretProblem(
  env: Env,
  variable: string,
  label: string,
): ConfigProblem | null {
  const value = env[variable];
  if (blank(value))
    return {
      variable,
      message: `${variable} manque : ${label} (au moins ${MIN_SECRET} caractères aléatoires).`,
    };
  const text = (value as string).trim();
  if (text.length < MIN_SECRET || WEAK.has(text.toLowerCase()))
    return {
      variable,
      message: `${variable} est trop courte ou prévisible : ${label} exige au moins ${MIN_SECRET} caractères aléatoires.`,
    };
  return null;
}

/** Origine publique : https, sans chemin ni identifiants. */
function originProblem(raw: string | undefined): ConfigProblem | null {
  if (blank(raw))
    return {
      variable: "AQR_PUBLIC_ORIGIN",
      message:
        "AQR_PUBLIC_ORIGIN manque : l'adresse publique (https://hôte) est exigée en accès public.",
    };
  try {
    const url = new URL(raw as string);
    const plain =
      url.pathname === "/" && !url.search && !url.hash && !url.username;
    if (url.protocol !== "https:" || !plain)
      return {
        variable: "AQR_PUBLIC_ORIGIN",
        message:
          "AQR_PUBLIC_ORIGIN doit être une origine https sans chemin ni identifiants (ex. https://atelier.exemple.org).",
      };
  } catch {
    return {
      variable: "AQR_PUBLIC_ORIGIN",
      message: "AQR_PUBLIC_ORIGIN n'est pas une adresse valide.",
    };
  }
  return null;
}

/** Liste des écarts de configuration ; vide si tout est en ordre. N'ouvre aucun fichier. */
export function securityConfigProblems(
  env: Env = process.env,
): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const add = (problem: ConfigProblem | null) => {
    if (problem) problems.push(problem);
  };
  const localOnly = env.AQR_LOCAL_ONLY === "1";
  const hasToken = !blank(env.AQR_ACCESS_TOKEN);

  if (localOnly && hasToken)
    add({
      variable: "AQR_LOCAL_ONLY",
      message:
        "AQR_LOCAL_ONLY=1 et AQR_ACCESS_TOKEN sont tous deux définis : choisir un seul mode d'accès (local ou public).",
    });
  if (!localOnly && !hasToken)
    add({
      variable: "AQR_ACCESS_TOKEN",
      message:
        "Aucun mode d'accès déclaré : définir AQR_ACCESS_TOKEN (accès public) ou AQR_LOCAL_ONLY=1 (poste local).",
    });

  if (hasToken && !localOnly) {
    add(secretProblem(env, "AQR_ACCESS_TOKEN", "le jeton d'accès"));
    add(originProblem(env.AQR_PUBLIC_ORIGIN));
    if (env.AQR_TRUST_PROXY !== "0" && env.AQR_TRUST_PROXY !== "1")
      add({
        variable: "AQR_TRUST_PROXY",
        message:
          "AQR_TRUST_PROXY doit être déclaré (1 derrière un reverse proxy de confiance, 0 sinon) : sans lui l'adresse réelle des visiteurs est inconnue.",
      });
    const signup = (env.AQR_SIGNUP ?? "").trim().toLowerCase();
    if (!["open", "code", "closed"].includes(signup))
      add({
        variable: "AQR_SIGNUP",
        message:
          "AQR_SIGNUP doit être déclaré : open, code ou closed (les inscriptions ne restent pas ouvertes par défaut en public).",
      });
    if (signup === "code" && blank(env.AQR_SIGNUP_CODE))
      add({
        variable: "AQR_SIGNUP_CODE",
        message: "AQR_SIGNUP=code exige AQR_SIGNUP_CODE.",
      });

    // Secrets propres à chaque environnement : jamais la valeur par défaut du code.
    add(secretProblem(env, "AQR_AUDIT_SALT", "le sel des empreintes d'audit"));
    add(secretProblem(env, "AQR_FORM_KEY", "la clé des jetons de formulaire"));
    // Clé du direct : seulement si le direct est branché ; le fichier local ne suffit pas en public.
    if (!blank(env.AQR_LIVE_URL))
      add(secretProblem(env, "AQR_LIVE_KEY", "la clé de signature du direct"));
  }

  return problems;
}

/** Message unique et lisible, prêt pour le journal (jamais de valeur de secret). */
export function describeProblems(problems: ConfigProblem[]): string {
  return `Configuration de sécurité incomplète (${problems.length}) : ${problems
    .map((p) => p.message)
    .join(" ")}`;
}
