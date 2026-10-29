import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";

/**
 * Journaux en fichiers : un fichier par flux et par jour (UTC), une ligne JSON par événement,
 * rotation par taille, rétention par flux, droits 0640. Jamais bloquant : une erreur d'écriture
 * n'arrête pas l'appelant (le journal console reste la voie de secours).
 *
 * Le flux `security` est un journal d'AUDIT : ajout seul, chaque ligne porte `prev` (empreinte de la
 * ligne précédente) et `hash` (empreinte de celle-ci). Modifier, supprimer ou insérer une ligne casse
 * la chaîne, et `verifyChain` dit à quelle ligne.
 */
export type Stream = "app" | "security" | "access" | "queue";
export const STREAMS: readonly Stream[] = [
  "app",
  "security",
  "access",
  "queue",
];

export type LogRecord = {
  level: "info" | "warn" | "error";
  scope: string;
  msg: string;
  /** Identifiant de corrélation de la requête (`X-Request-Id`). */
  rid?: string;
  [key: string]: unknown;
};

export type LogFilesOptions = {
  dir: string;
  now?: () => Date;
  /** Taille au-delà de laquelle on passe au fichier suivant du jour (octets). */
  maxBytes?: number;
  retentionDays?: Record<Stream, number>;
};

export const DEFAULT_RETENTION: Record<Stream, number> = {
  app: 30,
  access: 30,
  queue: 90,
  security: 365,
};
const GENESIS = "0".repeat(16);
const FILE =
  /^(app|security|access|queue)-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;

const link = (prev: string, body: string): string =>
  createHash("sha256")
    .update(prev + body)
    .digest("hex")
    .slice(0, 16);

export class LogFiles {
  private readonly dir: string;
  private readonly now: () => Date;
  private readonly maxBytes: number;
  private readonly retention: Record<Stream, number>;
  private lastHash: string | null = null;

  constructor(options: LogFilesOptions) {
    this.dir = options.dir;
    this.now = options.now ?? (() => new Date());
    this.maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
    this.retention = options.retentionDays ?? DEFAULT_RETENTION;
  }

  private day(): string {
    return this.now().toISOString().slice(0, 10);
  }

  /** Fichier courant du flux : celui du jour, ou son suffixe suivant une fois la taille atteinte. */
  private currentFile(stream: Stream): string {
    const day = this.day();
    for (let index = 0; ; index++) {
      const name = `${stream}-${day}${index === 0 ? "" : `.${index}`}.log`;
      // Rotation : on cherche le premier fichier qui n'a pas atteint la taille maximale.
      const file = path.join(this.dir, name);
      if (!existsSync(file)) return file;
      if (statSync(file).size < this.maxBytes) return file;
    }
  }

  /** Dernière empreinte de la chaîne d'audit : relue sur le plus récent fichier, une seule fois. */
  private chainHead(): string {
    if (this.lastHash !== null) return this.lastHash;
    let head = GENESIS;
    try {
      const files = readdirSync(this.dir)
        .map((name) => ({ name, match: FILE.exec(name) }))
        .filter((entry) => entry.match?.[1] === "security")
        .sort((a, b) =>
          `${a.match?.[2]}.${String(a.match?.[3] ?? 0).padStart(6, "0")}`.localeCompare(
            `${b.match?.[2]}.${String(b.match?.[3] ?? 0).padStart(6, "0")}`,
          ),
        );
      for (let i = files.length - 1; i >= 0 && head === GENESIS; i--) {
        const rows = readFileSync(path.join(this.dir, files[i].name), "utf8")
          .trim()
          .split("\n");
        const last = rows.at(-1);
        if (last)
          head = (JSON.parse(last) as { hash?: string }).hash ?? GENESIS;
      }
    } catch {
      /* dossier absent ou ligne illisible : la chaîne repart de zéro */
    }
    this.lastHash = head;
    return head;
  }

  write(stream: Stream, record: LogRecord): void {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o750 });
      const entry: Record<string, unknown> = {
        ts: this.now().toISOString(),
        ...record,
      };
      let line: string;
      if (stream === "security") {
        const prev = this.chainHead();
        entry.prev = prev;
        const hash = link(prev, JSON.stringify(entry));
        entry.hash = hash;
        line = JSON.stringify(entry);
        this.lastHash = hash;
      } else line = JSON.stringify(entry);
      const file = this.currentFile(stream);
      const created = !existsSync(file);
      if (created) closeSync(openSync(file, "a", 0o640));
      appendFileSync(file, `${line}\n`, { encoding: "utf8" });
    } catch {
      /* la journalisation ne doit jamais faire échouer le travail */
    }
  }

  /** Supprime les fichiers plus vieux que la rétention de leur flux ; rend leur nombre. */
  prune(): number {
    let removed = 0;
    try {
      const now = this.now().getTime();
      for (const name of readdirSync(this.dir)) {
        const match = FILE.exec(name);
        if (!match) continue;
        const age =
          (now - statSync(path.join(this.dir, name)).mtimeMs) / 86_400_000;
        if (age > this.retention[match[1] as Stream]) {
          unlinkSync(path.join(this.dir, name));
          removed += 1;
        }
      }
    } catch {
      /* rien à purger, ou dossier absent */
    }
    return removed;
  }
}

/** Vérifie la chaîne d'un fichier d'audit : `badLine` (à partir de 1) est la première ligne fautive. */
export function verifyChain(
  text: string,
  expectedFirstPrev?: string,
): { ok: true; lines: number } | { ok: false; badLine: number } {
  const rows = text.split("\n").filter((row) => row.trim() !== "");
  let prev: string | undefined = expectedFirstPrev;
  for (let i = 0; i < rows.length; i++) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(rows[i]) as Record<string, unknown>;
    } catch {
      return { ok: false, badLine: i + 1 };
    }
    const { hash, ...rest } = entry;
    if (typeof hash !== "string" || typeof rest.prev !== "string")
      return { ok: false, badLine: i + 1 };
    if (prev !== undefined && rest.prev !== prev)
      return { ok: false, badLine: i + 1 };
    if (link(rest.prev, JSON.stringify(rest)) !== hash)
      return { ok: false, badLine: i + 1 };
    prev = hash;
  }
  return { ok: true, lines: rows.length };
}
