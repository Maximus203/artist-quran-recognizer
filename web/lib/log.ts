/**
 * Journal serveur : UNE seule porte de sortie (loi « aucun log fantôme »). Une ligne lisible par
 * événement, jamais de jeton, de mot de passe ni de cookie : on ne journalise que l'étiquette de
 * la portée, un message et le message de l'erreur (pas sa pile, qui peut citer des chemins).
 */
type Level = "info" | "warn" | "error";

const sink = (level: Level, line: string): void => {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
};

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

export function formatLog(
  level: Level,
  scope: string,
  message: string,
  error?: unknown,
  now = new Date(),
): string {
  const detail = describe(error);
  return `[aqr] ${now.toISOString()} ${level.toUpperCase()} ${scope}: ${message}${
    detail ? ` (${detail})` : ""
  }`;
}

export const log = {
  info: (scope: string, message: string) =>
    sink("info", formatLog("info", scope, message)),
  warn: (scope: string, message: string, error?: unknown) =>
    sink("warn", formatLog("warn", scope, message, error)),
  error: (scope: string, message: string, error?: unknown) =>
    sink("error", formatLog("error", scope, message, error)),
};
