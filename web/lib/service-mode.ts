import { existsSync } from "node:fs";
import path from "node:path";
import { reviewRoot } from "./store";

/**
 * Arrêt d'urgence sans tout couper (section 15 de docs/SECURITE-PRE-DEPLOIEMENT.md). Trois modes :
 *  - `normal` ;
 *  - `restricted` : plus d'inscriptions, d'envois de fichiers, d'analyses, d'exports ni de direct ;
 *    la connexion et la lecture continuent ;
 *  - `maintenance` : tout répond 503 avec une page claire, sauf `/api/health` (la supervision voit).
 *
 * On le change sans redéploiement ni redémarrage : un fichier vide `control/restricted` ou
 * `control/maintenance` dans le dossier de données (`touch` pour activer, `rm` pour lever, effet en
 * moins de 2 s). `AQR_SERVICE_MODE` fixe le mode au démarrage ; le plus strict des deux l'emporte.
 */
export type ServiceMode = "normal" | "restricted" | "maintenance";
export type Refusal = {
  status: number;
  code: string;
  error: string;
  retryAfterS: number;
};

const CACHE_MS = 2_000;
const cache: { at: number; mode: ServiceMode; key: string } = {
  at: 0,
  mode: "normal",
  key: "",
};

export const controlDir = (): string => path.join(reviewRoot(), "control");

const fromEnv = (raw: string | undefined): ServiceMode =>
  raw === "maintenance" || raw === "restricted" ? raw : "normal";

/** Mode courant. Lecture mise en cache 2 s : un `stat` par requête serait du gaspillage. */
export function currentMode(
  now = Date.now(),
  env: Record<string, string | undefined> = process.env,
): ServiceMode {
  const dir = controlDir();
  const key = `${dir}|${env.AQR_SERVICE_MODE ?? ""}`;
  if (cache.key === key && now - cache.at < CACHE_MS) return cache.mode;
  let mode = fromEnv(env.AQR_SERVICE_MODE);
  try {
    if (existsSync(path.join(dir, "maintenance"))) mode = "maintenance";
    else if (existsSync(path.join(dir, "restricted")) && mode === "normal")
      mode = "restricted";
  } catch {
    // Dossier illisible : on garde le mode de l'environnement (la disponibilité prime).
  }
  Object.assign(cache, { at: now, mode, key });
  return mode;
}

/** Pour les tests : oublie la lecture en cache. */
export function resetModeCache(): void {
  Object.assign(cache, { at: 0, mode: "normal", key: "" });
}

const SUSPENDED = new Set(["upload", "generate", "live"]);

/** Refus à opposer à une requête dans ce mode, ou `null` si elle passe. Pure, donc testable. */
export function modeRefusal(
  mode: ServiceMode,
  method: string,
  pathname: string,
  family: string,
): Refusal | null {
  if (mode === "normal" || pathname === "/api/health") return null;
  if (mode === "maintenance")
    return {
      status: 503,
      code: "maintenance",
      error:
        "Le service est en maintenance. Réessaie dans quelques minutes : tes données sont conservées.",
      retryAfterS: 300,
    };
  const isRegister =
    pathname === "/api/auth/register" && method.toUpperCase() === "POST";
  if (isRegister || SUSPENDED.has(family))
    return {
      status: 503,
      code: "restricted",
      error:
        "Le service est en mode restreint : les inscriptions, les envois, les analyses et le direct sont suspendus. La lecture reste disponible.",
      retryAfterS: 300,
    };
  return null;
}

/** Page affichée à un navigateur en maintenance : autonome (aucune ressource externe). */
export const MAINTENANCE_PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Maintenance</title><style>body{font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#faf7f2;color:#1f2a24}main{max-width:32rem}h1{font-size:1.4rem}</style></head><body><main><h1>Maintenance en cours</h1><p>Le service est momentanément indisponible. Tes enregistrements et tes analyses sont conservés. Réessaie dans quelques minutes.</p></main></body></html>`;
