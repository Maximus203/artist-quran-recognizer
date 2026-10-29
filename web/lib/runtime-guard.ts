/**
 * Garde de version de Node.js. CVE-2026-111497 (« Node2Shell », écriture hors limites dans le
 * décodeur Brotli de `node:zlib`) est corrigée dans 22.23.4, 24.22.1 et 26.12.1 (avis officiel :
 * https://nodejs.org/en/blog/vulnerability/october-2026-security-releases). Les lignes en fin de vie
 * (18, 20, 23, 25…) ne reçoivent aucun correctif. En production, un serveur lancé sur une version
 * touchée refuse de démarrer ; en développement, il prévient seulement.
 */
import { describeProblems, securityConfigProblems } from "./config-guard";

export type RuntimeStatus = { ok: boolean; message: string };

/** Première version corrigée de chaque ligne maintenue. */
const FIXED: Record<number, [number, number, number]> = {
  22: [22, 23, 4],
  24: [24, 22, 1],
  26: [26, 12, 1],
};
const NEWEST_KNOWN = 26;

export function nodeVersionStatus(version: string): RuntimeStatus {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!match)
    return {
      ok: false,
      message: `Version de Node illisible (« ${version} ») : impossible de vérifier la faille CVE-2026-111497.`,
    };
  const found = [Number(match[1]), Number(match[2]), Number(match[3])];
  const label = `${found[0]}.${found[1]}.${found[2]}`;
  const major = found[0];
  if (major > NEWEST_KNOWN) return { ok: true, message: `Node ${label}.` };
  const fixed = FIXED[major];
  if (!fixed)
    return {
      ok: false,
      message: `Node ${label} est en fin de vie et ne reçoit aucun correctif pour la faille CVE-2026-111497 (décodeur Brotli) : passer à Node 24.22.1 ou plus.`,
    };
  const behind =
    found[1] < fixed[1] || (found[1] === fixed[1] && found[2] < fixed[2]);
  if (behind)
    return {
      ok: false,
      message: `Node ${label} contient la faille CVE-2026-111497 (décodeur Brotli) : passer à Node ${fixed.join(".")} ou plus.`,
    };
  return { ok: true, message: `Node ${label}.` };
}

/**
 * Coût des empreintes de mots de passe : `AQR_SCRYPT_LOG_N` ne peut qu'ALOURDIR en production
 * (minimum 2^17, recommandation OWASP). Sans la variable, la valeur par défaut s'applique.
 */
export function scryptConfigStatus(
  env: Record<string, string | undefined> = process.env,
): RuntimeStatus {
  const raw = env.AQR_SCRYPT_LOG_N;
  if (raw === undefined || raw.trim() === "")
    return { ok: true, message: "Coût scrypt par défaut." };
  const log = Number(raw);
  if (Number.isInteger(log) && log >= 17 && log <= 20)
    return { ok: true, message: `Coût scrypt 2^${log}.` };
  return {
    ok: false,
    message: `AQR_SCRYPT_LOG_N=${raw} affaiblit les mots de passe : il faut un entier de 17 à 20 (ou retirer la variable).`,
  };
}

/** Production : lève une erreur lisible ; autrement : un avertissement. */
export function enforceRuntime(
  nodeEnv: string | undefined,
  version: string = process.versions.node,
  warn: (message: string) => void = () => undefined,
): void {
  const status = nodeVersionStatus(version);
  if (status.ok) return;
  if (nodeEnv === "production")
    throw new Error(`${status.message} Le serveur ne démarre pas.`);
  warn(status.message);
}

/**
 * Appelé au démarrage du serveur : avertit en développement ; en production, journalise puis arrête
 * le processus (un serveur à l'arrêt se voit, un serveur qui répond 500 s'oublie).
 */
export function guardStartup(
  report: { warn: (m: string) => void; error: (m: string, e: unknown) => void },
  options: {
    nodeEnv?: string | undefined;
    version?: string;
    exit?: (code: number) => void;
    env?: Record<string, string | undefined>;
  } = {},
): void {
  const { nodeEnv = process.env.NODE_ENV, version, exit } = options;
  try {
    // Poste local (AQR_LOCAL_ONLY=1, seule la boucle locale est servie) : la faille de Node est signalée
    // mais ne bloque pas ; la faille se joue par un contenu compressé venu d'ailleurs.
    const localOnly = (options.env ?? process.env).AQR_LOCAL_ONLY === "1";
    enforceRuntime(localOnly ? "local" : nodeEnv, version, report.warn);
    const scrypt = scryptConfigStatus(options.env);
    if (!scrypt.ok) {
      if (nodeEnv === "production")
        throw new Error(`${scrypt.message} Le serveur ne démarre pas.`);
      report.warn(scrypt.message);
    }
    const problems = securityConfigProblems(options.env);
    if (problems.length > 0) {
      if (nodeEnv === "production")
        throw new Error(
          `${describeProblems(problems)} Le serveur ne démarre pas.`,
        );
      report.warn(describeProblems(problems));
    }
  } catch (error) {
    report.error("démarrage refusé", error);
    (exit ?? ((code) => process.exit(code)))(1);
  }
}
