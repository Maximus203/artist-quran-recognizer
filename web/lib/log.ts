import path from "node:path";
import {
  LogFiles,
  type LogRecord,
  type Stream,
  DEFAULT_RETENTION,
} from "./log-files";
import { currentRequestId } from "./request-context";

/**
 * Journal serveur : UNE seule porte de sortie (loi « aucun log fantôme »). La console garde une ligne
 * lisible par événement ; les fichiers (voir `log-files.ts`) reçoivent la même information en JSON,
 * un flux par usage (app, security, access, queue), avec l'identifiant de corrélation de la requête.
 *
 * Défense en profondeur : même si un appelant laisse passer un secret ou un texte coranique dans un
 * message, `redact` le masque avant toute écriture (jeton d'API, cookie de session, en-tête
 * Authorization, longue clé aléatoire, texte arabe). On ne journalise que l'étiquette de la portée,
 * un message et le message de l'erreur (pas sa pile, qui peut citer des chemins).
 */
type Level = "info" | "warn" | "error";

const OMITTED = "<omis>";
const SECRETS: RegExp[] = [
  /Bearer\s+\S+/gi,
  /qtr_[A-Za-z0-9_-]{16,}/g,
  /aqr_session=[^;\s]+/g,
  // une longue suite base64url ou hexadécimale ressemble à un secret, pas à un identifiant de session
  /(?<![0-9a-f-])[A-Za-z0-9_-]{40,}(?![0-9a-f-])/g,
];
const ARABIC = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+/g;

export function redact(text: string): string {
  let out = text;
  for (const pattern of SECRETS) out = out.replace(pattern, OMITTED);
  return out.replace(ARABIC, OMITTED).replace(/[\r\n]+/g, " ");
}

const SECURITY = new Set([
  "audit",
  "security",
  "honeypot",
  "blocklist",
  "ratelimit",
]);
const QUEUE = new Set(["jobs", "queue", "export", "video", "analysis"]);
export function streamOf(scope: string): Stream {
  if (SECURITY.has(scope)) return "security";
  if (scope === "access") return "access";
  if (QUEUE.has(scope)) return "queue";
  return "app";
}

const consoleSink = (level: Level, line: string): void => {
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
  const detail = redact(describe(error));
  return `[aqr] ${now.toISOString()} ${level.toUpperCase()} ${scope}: ${redact(message)}${
    detail ? ` (${detail})` : ""
  }`;
}

// ── Fichiers ──────────────────────────────────────────────────────────────────────────────────
const FILES = Symbol.for("aqr.log-files");
type Holder = { [FILES]?: LogFiles | null };

/** Dossier des journaux : `AQR_LOG_DIR`, sinon `<dossier de données>/logs`. */
export function logDir(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.AQR_LOG_DIR) return path.resolve(env.AQR_LOG_DIR);
  const base = env.AQR_REVIEW_DIR;
  return base ? path.resolve(base, "logs") : "";
}

function retention(env: Record<string, string | undefined>) {
  const days = (raw: string | undefined, fallback: number) => {
    const value = Number(raw);
    return Number.isInteger(value) && value >= 1 ? value : fallback;
  };
  const general = days(env.AQR_LOG_RETENTION_DAYS, DEFAULT_RETENTION.app);
  return {
    app: general,
    access: general,
    queue: Math.max(general, DEFAULT_RETENTION.queue),
    security: days(env.AQR_AUDIT_RETENTION_DAYS, DEFAULT_RETENTION.security),
  };
}

/** Les fichiers du processus : créés à la première écriture, jamais pendant les tests (NODE_ENV=test). */
function files(): LogFiles | null {
  const holder = globalThis as Holder;
  if (holder[FILES] !== undefined) return holder[FILES] ?? null;
  const env = process.env;
  const dir = logDir(env);
  const enabled = env.NODE_ENV !== "test" || Boolean(env.AQR_LOG_DIR);
  holder[FILES] =
    enabled && dir
      ? new LogFiles({ dir, retentionDays: retention(env) })
      : null;
  return holder[FILES] ?? null;
}
/** Remplace les fichiers du processus (tests) ; `null` les désactive. */
export function useLogFiles(logs: LogFiles | null): void {
  (globalThis as Holder)[FILES] = logs;
}
/** Purge les fichiers expirés ; au démarrage puis chaque jour (voir `instrumentation.ts`). */
export function pruneLogs(): number {
  return files()?.prune() ?? 0;
}

function emit(
  level: Level,
  scope: string,
  message: string,
  error?: unknown,
  extra: Record<string, unknown> = {},
  consoleMessage = message,
): void {
  // Une ligne d'accès par requête n'a pas sa place dans la console : elle va dans le fichier.
  if (scope !== "access")
    consoleSink(level, formatLog(level, scope, consoleMessage, error));
  const detail = redact(describe(error));
  const record: LogRecord = {
    level,
    scope,
    msg: redact(message) + (detail ? ` (${detail})` : ""),
    ...extra,
  };
  const rid = currentRequestId();
  if (rid) record.rid = rid;
  files()?.write(streamOf(scope), record);
}

export const log = {
  info: (scope: string, message: string) => emit("info", scope, message),
  warn: (scope: string, message: string, error?: unknown) =>
    emit("warn", scope, message, error),
  error: (scope: string, message: string, error?: unknown) =>
    emit("error", scope, message, error),
  /**
   * Événement structuré : `event` est le nom stable à chercher (`analysis.done`), `fields` des nombres
   * et identifiants opaques (durée `ms`, moteur, identifiant de session) : jamais de contenu.
   */
  event: (
    scope: string,
    event: string,
    fields: Record<string, string | number | boolean | null> = {},
    level: Level = "info",
  ) => {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields))
      safe[key] = typeof value === "string" ? redact(value) : value;
    // Console : une ligne JSON ; fichier : `msg` = nom de l'événement, champs à plat.
    emit(
      level,
      scope,
      event,
      undefined,
      safe,
      JSON.stringify({ event, ...safe }),
    );
  },
};
