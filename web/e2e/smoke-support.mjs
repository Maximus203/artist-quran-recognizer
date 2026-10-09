/**
 * Logique pure du smoke navigateur (testée par smoke-support.test.mjs, sans navigateur ni
 * serveur) : présence des ressources, mode strict, verdict d'une session, choix du segment.
 * Toutes les dépendances système (fichiers, Python, horloge) sont injectées.
 */
import path from "node:path";

export const DEFAULT_CHROMIUM = "/opt/pw-browsers/chromium";
const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

/** AQR_SMOKE_STRICT=1 : une ressource absente est un échec (exit 2), jamais un succès muet. */
export const isStrict = (env) =>
  TRUE_VALUES.has(
    String(env.AQR_SMOKE_STRICT ?? "")
      .trim()
      .toLowerCase(),
  );

/** Ressources vérifiées côté Node ; ffmpeg, modèles et corpus (LOCK.json) viennent de Python. */
export async function findMissingResources({
  env,
  webDir,
  exists,
  canExecute,
  preflight,
}) {
  const missing = [];
  const audio = env.AQR_SMOKE_AUDIO;
  if (!audio)
    missing.push({
      resource: "audio",
      reason:
        "AQR_SMOKE_AUDIO absent (audio hors dépôt ; scripts/smoke_e2e.sh le prépare)",
    });
  else if (!exists(audio))
    missing.push({
      resource: "audio",
      reason: `AQR_SMOKE_AUDIO=${audio} introuvable`,
    });

  const chromium = env.AQR_SMOKE_CHROMIUM || DEFAULT_CHROMIUM;
  if (!exists(chromium) || !canExecute(chromium))
    missing.push({
      resource: "chromium",
      reason: `Chromium introuvable ou non exécutable : ${chromium} (AQR_SMOKE_CHROMIUM ; aucun playwright install n'est lancé)`,
    });

  const remote = Boolean(env.AQR_SMOKE_URL);
  if (!remote && !exists(path.join(webDir, ".next", "BUILD_ID")))
    missing.push({
      resource: "web-build",
      reason: "build Next absent (cd web && npm run build)",
    });

  // Un serveur distant (AQR_SMOKE_URL) a ses propres modèles : seul le corpus sert ici.
  const needs = remote ? ["corpus"] : ["ffmpeg", "models", "corpus"];
  try {
    missing.push(...(await preflight(needs)));
  } catch (error) {
    missing.push({
      resource: "python",
      reason: `AQR_PYTHON (${env.AQR_PYTHON || "python"}) inutilisable : ${error.message}`,
    });
  }
  return missing;
}

/** Rien ne manque : on lance. Sinon strict => échec (2), non strict => skip net (0). */
export function decide({ strict, missing }) {
  if (missing.length === 0) return { action: "run", exitCode: 0, message: "" };
  const lines = missing
    .map((m) => `  - ${m.resource} : ${m.reason}`)
    .join("\n");
  if (strict)
    return {
      action: "fail",
      exitCode: 2,
      message: `FAIL browser-smoke (AQR_SMOKE_STRICT=1) : ressource(s) absente(s)\n${lines}`,
    };
  return {
    action: "skip",
    exitCode: 0,
    message:
      `SKIP browser-smoke : NON EXÉCUTÉ, rien n'a été vérifié (${missing.length} ressource(s) absente(s))\n${lines}\n` +
      "AQR_SMOKE_STRICT=1 (défaut de scripts/smoke_e2e.sh) en ferait un échec.",
  };
}

/** Verdict immédiat d'après GET /api/sessions/<id> : pending | done | failed. */
export function sessionVerdict(detail) {
  const session = detail?.session;
  if (!session) return { kind: "failed", message: "réponse sans session" };
  if (session.state === "failed")
    return {
      kind: "failed",
      message: `session en échec : ${session.error || "sans message d'erreur"}`,
    };
  if (session.state === "cancelled")
    return { kind: "failed", message: "session annulée" };
  if (session.state === "done")
    return detail.result
      ? { kind: "done", message: "" }
      : { kind: "failed", message: "session terminée sans résultat lisible" };
  return { kind: "pending", message: `état ${session.state}` };
}

/**
 * Interroge la session jusqu'à `done` ; lève dès qu'elle est `failed`/`cancelled` (avec son
 * erreur) au lieu d'attendre le délai complet.
 */
export async function waitForSession({
  fetchDetail,
  timeoutMs,
  intervalMs = 2000,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const deadline = now() + timeoutMs;
  let last = "aucune réponse";
  for (;;) {
    const detail = await fetchDetail();
    const verdict = sessionVerdict(detail);
    if (verdict.kind === "done") return detail;
    if (verdict.kind === "failed") throw new Error(verdict.message);
    last = verdict.message;
    if (now() >= deadline)
      throw new Error(
        `délai dépassé (${Math.round(timeoutMs / 1000)} s) ; dernier état : ${last}`,
      );
    await sleep(intervalMs);
  }
}

/**
 * Versets RECOGNIZED de la sourate attendue avec leur texte, dans l'ordre du résultat : jamais un
 * incertain (sans texte) ni un déduit, que l'interface n'affiche pas comme une preuve.
 */
export function recognizedSegments(result, surah) {
  const found = [];
  (result?.intervals ?? []).forEach((interval, index) => {
    if (
      interval.kind === "verse" &&
      interval.status === "recognized" &&
      typeof interval.ref === "string" &&
      interval.ref.startsWith(`${surah}:`) &&
      interval.text
    )
      found.push({ index, interval });
  });
  return found;
}
