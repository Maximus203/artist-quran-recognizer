/**
 * Un identifiant de session est un UUID. Côté navigateur il vient parfois de l'adresse
 * (`?session=…`) : on ne le met dans un chemin d'API qu'après ce contrôle, jamais tel quel.
 */
const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isSessionId = (value: unknown): value is string =>
  typeof value === "string" && SESSION_ID.test(value);
