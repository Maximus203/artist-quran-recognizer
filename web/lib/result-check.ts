/**
 * Contrôle d'un résultat `aqr.recognition/1` reçu à l'import, avant qu'il soit conservé.
 *
 * Le serveur web n'a pas le corpus (comme l'export, il passe par le moteur : `aqr verify-recognition`,
 * jamais un second contrôle en TypeScript qui finirait par diverger). Règle : on ne fait confiance à
 * AUCUN texte reçu — l'arabe doit être celui du corpus (I1), la traduction celle de QuranEnc, sans
 * modification (I2). Un contrôle qui n'a pas pu avoir lieu n'est jamais un « oui » (I3).
 */
import path from "node:path";
import { ImportError } from "./import-error";
import { lastError, runPython, type PythonRunner } from "./python";
import { REPO } from "./store";

export type ResultFinding = {
  /** Rang de l'intervalle dans le résultat (à partir de 0), `null` : tout le document. */
  index: number | null;
  ref: string | null;
  field: string;
  message: string;
  /** Traduction invérifiable seulement : `offline`, `local_copy` ou `no_source` (message choisi selon elle). */
  cause?: string;
};

export type ResultVerdict =
  | { status: "ok" }
  | { status: "invalid"; findings: ResultFinding[]; total: number }
  | { status: "unverifiable"; findings: ResultFinding[]; total: number }
  | { status: "unavailable"; reason: string };

const MAX_SHOWN = 3;
const MAX_RUNNING = 2;
let running = 0;
const waiting: (() => void)[] = [];

/** Au plus deux contrôles à la fois : chacun lance un processus Python qui lit le corpus. */
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_RUNNING)
    await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await task();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

type Report = {
  status?: unknown;
  findings?: unknown;
  findings_total?: unknown;
  unverifiable?: unknown;
  unverifiable_total?: unknown;
};

const isFinding = (value: unknown): value is ResultFinding => {
  if (typeof value !== "object" || value === null) return false;
  const f = value as Record<string, unknown>;
  return (
    (f.index === null || typeof f.index === "number") &&
    (f.ref === null || typeof f.ref === "string") &&
    typeof f.field === "string" &&
    typeof f.message === "string" &&
    (f.cause === undefined || typeof f.cause === "string")
  );
};
const findingsOf = (value: unknown): ResultFinding[] =>
  Array.isArray(value) ? value.filter(isFinding) : [];

/**
 * Lance `verify-recognition` sur le fichier et traduit sa réponse (code 0 fidèle · 1 contredit le
 * corpus · 4 traduction invérifiable). Toute autre issue — moteur absent, corpus manquant, sortie
 * illisible, code et rapport qui se contredisent — est « indisponible » : le résultat est refusé.
 */
export async function verifyResultFile(
  file: string,
  run: PythonRunner = runPython,
): Promise<ResultVerdict> {
  const result = await limited(() =>
    run([
      "verify-recognition",
      file,
      "--corpus-dir",
      process.env.AQR_CORPUS_DIR || path.join(REPO, "data", "corpus"),
    ]),
  );
  let report: Report;
  try {
    report = JSON.parse(result.stdout) as Report;
  } catch {
    return { status: "unavailable", reason: lastError(result) };
  }
  if (result.code === 0 && report.status === "ok") return { status: "ok" };
  if (result.code === 1 && report.status === "invalid")
    return {
      status: "invalid",
      findings: findingsOf(report.findings),
      total:
        typeof report.findings_total === "number" ? report.findings_total : 1,
    };
  if (result.code === 4 && report.status === "unverifiable")
    return {
      status: "unverifiable",
      findings: findingsOf(report.unverifiable),
      total:
        typeof report.unverifiable_total === "number"
          ? report.unverifiable_total
          : 1,
    };
  return { status: "unavailable", reason: lastError(result) };
}

/** Pourquoi la traduction n'a pas pu être vérifiée : la phrase suit la vraie cause (jamais « QuranEnc injoignable » pour une copie locale illisible). */
const UNVERIFIABLE_REASON: Record<string, string> = {
  offline:
    "Impossible de vérifier la traduction jointe : QuranEnc n'est pas joignable pour l'instant.",
  local_copy:
    "Impossible de vérifier la traduction jointe : la copie locale des traductions QuranEnc est illisible sur ce serveur.",
  no_source:
    "Impossible de vérifier la traduction jointe : aucune source de traduction n'est configurée sur ce serveur.",
  unknown:
    "La traduction jointe n'a pas pu être vérifiée auprès de la source QuranEnc.",
};

/** Une référence n'est recopiée dans un message que si elle a la forme sourate:verset. */
const SAFE_REF = /^\d{1,3}:\d{1,3}$/;
const where = (f: ResultFinding): string =>
  `${f.index === null ? "résultat" : `intervalle ${f.index + 1}`}${
    f.ref && SAFE_REF.test(f.ref) ? ` (${f.ref})` : ""
  }`;

/**
 * Le refus à montrer pour un verdict, ou `null` s'il est bon. Les messages du moteur sont des phrases
 * fixes ; rien du contenu reçu n'est recopié.
 */
export function refusalOf(verdict: ResultVerdict): ImportError | null {
  switch (verdict.status) {
    case "ok":
      return null;
    case "invalid": {
      const shown = verdict.findings
        .slice(0, MAX_SHOWN)
        .map((f) => `${where(f)} : ${f.message.replace(/\.+$/, "")}`)
        .join(" ; ");
      const more = verdict.total - Math.min(verdict.findings.length, MAX_SHOWN);
      return new ImportError(
        422,
        `Le résultat joint contredit le corpus${shown ? ` — ${shown}` : ""}${
          more > 0
            ? ` ; ${more} autre${more > 1 ? "s" : ""} écart${more > 1 ? "s" : ""}`
            : ""
        }. L'arabe doit être celui du Mushaf et la traduction celle de QuranEnc, sans modification. Rien n'a été importé.`,
        "result_contradicts_corpus",
      );
    }
    case "unverifiable": {
      const cause = verdict.findings[0]?.cause ?? "";
      const reason = Object.hasOwn(UNVERIFIABLE_REASON, cause)
        ? UNVERIFIABLE_REASON[cause]
        : UNVERIFIABLE_REASON.unknown;
      const next =
        cause === "local_copy"
          ? "signale-le à l'administrateur"
          : "réessaie plus tard";
      return new ImportError(
        503,
        `${reason} Rien n'a été importé ; ${next}, ou envoie le résultat sans traduction.`,
        "result_unverifiable",
      );
    }
    case "unavailable":
      return new ImportError(
        503,
        "Le contrôle du résultat joint est indisponible (corpus ou moteur introuvable). Rien n'a été importé ; réessaie plus tard.",
        "result_check_unavailable",
      );
  }
}

/** Un nom de champ du rapport (`translation.text`, `riwaya.assumed`…) ; tout autre est écrit « autre ». */
const SAFE_FIELD = /^[a-z_]+(\.[a-z_]+)*$/;
const safeField = (field: string): string =>
  SAFE_FIELD.test(field) ? field : "autre";
const MAX_REASON = 200;
const MAX_FIELDS_LOGGED = 5;

/**
 * Ce que le journal serveur garde d'un refus : l'issue, le rang de l'intervalle (à partir de 1), le
 * verset, le champ en cause, jamais le message ni le contenu reçu. Un 503 « indisponible » garde la
 * raison du moteur (une ligne bornée) : c'est la panne qu'on cherchera.
 */
export function describeVerdict(
  verdict: ResultVerdict,
): Record<string, string | number | null> {
  if (verdict.status === "ok") return { verdict: "ok" };
  if (verdict.status === "unavailable")
    return {
      verdict: "unavailable",
      reason: verdict.reason.replace(/\s+/g, " ").trim().slice(0, MAX_REASON),
    };
  const first = verdict.findings[0];
  const fields = [
    ...new Set(verdict.findings.map((f) => safeField(f.field))),
  ].slice(0, MAX_FIELDS_LOGGED);
  return {
    verdict: verdict.status,
    total: verdict.total,
    rank: first?.index == null ? null : first.index + 1,
    ref: first?.ref && SAFE_REF.test(first.ref) ? first.ref : null,
    field: first ? safeField(first.field) : null,
    fields: fields.join(","),
    ...(first?.cause && SAFE_FIELD.test(first.cause)
      ? { cause: first.cause }
      : {}),
  };
}
