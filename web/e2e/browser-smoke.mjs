#!/usr/bin/env node
/**
 * Smoke navigateur de l'atelier : import d'un audio -> moteur réel -> versets RECOGNIZED affichés
 * avec le texte exact du corpus -> export du pack ZIP vérifié. Aucun audio dans Git : le fichier
 * vient de AQR_SMOKE_AUDIO (par ex. produit par scripts/smoke_e2e.sh).
 *
 * Une ressource absente (audio, Chromium, build, Python, ffmpeg, modèles, corpus vérifié par
 * LOCK.json) est un ÉCHEC code 2 : le mode strict est le défaut. Seul AQR_SMOKE_STRICT=0, explicite,
 * donne un « SKIP ... NON EXÉCUTÉ » (code 0) : jamais un succès muet. `--check` vérifie seulement
 * les ressources (utilisé par smoke_e2e.sh avant les étapes longues).
 *
 * Variables :
 *   AQR_SMOKE_STRICT    défaut strict (ressource absente => exit 2) ; 0 explicite : skip autorisé
 *   AQR_SMOKE_AUDIO     audio à importer
 *   AQR_SMOKE_SURAH     sourate attendue (défaut 112)
 *   AQR_SMOKE_COMPLETE  0 : l'audio fourni n'est pas fait de versets entiers (plage non exigée)
 *   AQR_SMOKE_CHROMIUM  exécutable Chromium (défaut /opt/pw-browsers/chromium)
 *   AQR_SMOKE_URL       serveur déjà lancé ; sinon `next start` est lancé (npm run build requis)
 *   AQR_SMOKE_TOKEN     jeton d'accès si le serveur est en mode test distant
 *   AQR_SMOKE_TIMEOUT_S délai max du moteur (défaut 900) ; une session `failed` échoue aussitôt
 * Le moteur lit AQR_PYTHON (interpréteur du moteur : le venv NeMo pour fastconformer),
 * AQR_MODELS_DIR, AQR_CORPUS_DIR et AQR_ASR. Choix du moteur : AQR_SMOKE_ASR (même nom que le smoke
 * CLI), sinon AQR_ASR (nom historique, inchangé), sinon whisper ; scripts/smoke_e2e.sh pose les deux
 * au même moteur.
 */
import { spawn } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CHROMIUM,
  decide,
  findMissingResources,
  isStrict,
  recognizedSegments,
  waitForSession,
} from "./smoke-support.mjs";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(WEB, "..");
const python = process.env.AQR_PYTHON || "python";
const asr = process.env.AQR_SMOKE_ASR || process.env.AQR_ASR || "whisper";
const pythonEnv = { ...process.env, PYTHONPATH: path.join(ROOT, "src") };

/** Lance Python depuis la racine du dépôt (modules tests.support.* et scripts.*). */
function runPython(args, { input = "", timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, {
      cwd: ROOT,
      env: pythonEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`délai dépassé : ${args.join(" ")}`));
    }, timeoutMs);
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

async function preflight(needs) {
  const done = await runPython([
    "-m",
    "tests.support.smoke_env",
    "--needs",
    needs.join(","),
    "--asr",
    asr,
  ]);
  if (done.code !== 0)
    throw new Error(
      done.stderr.trim().split("\n").pop() || `code ${done.code}`,
    );
  return JSON.parse(done.stdout);
}

const canExecute = (file) => {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const decision = decide({
  strict: isStrict(process.env),
  missing: await findMissingResources({
    env: process.env,
    webDir: WEB,
    exists: existsSync,
    canExecute,
    preflight,
  }),
});
if (decision.action !== "run") {
  (decision.action === "fail" ? console.error : console.log)(decision.message);
  process.exit(decision.exitCode);
}
if (process.argv.includes("--check")) {
  console.log("OK browser-smoke : toutes les ressources sont présentes");
  process.exit(0);
}

const { chromium } = await import("playwright-core");
const audio = process.env.AQR_SMOKE_AUDIO;
const surah = process.env.AQR_SMOKE_SURAH || "112";
const timeoutMs = Number(process.env.AQR_SMOKE_TIMEOUT_S || 900) * 1000;
const executablePath = process.env.AQR_SMOKE_CHROMIUM || DEFAULT_CHROMIUM;

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

async function startServer(reviewDir) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      path.join(WEB, "node_modules", "next", "dist", "bin", "next"),
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: WEB,
      env: { ...process.env, AQR_REVIEW_DIR: reviewDir, AQR_ASR: asr },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let log = "";
  child.stdout.on("data", (c) => (log = (log + c).slice(-4000)));
  child.stderr.on("data", (c) => (log = (log + c).slice(-4000)));
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error(`next start a quitté (${child.exitCode}) :\n${log}`);
    try {
      if ((await fetch(base)).status < 500) return { base, child };
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error(`next start n'a pas répondu :\n${log}`);
}

const steps = [];
const ok = (name) => {
  steps.push(name);
  console.log(`OK   ${name}`);
};
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const work = await mkdtemp(path.join(os.tmpdir(), "aqr-browser-smoke-"));
let server = null;
let browser = null;
let failure = null;
try {
  let base = process.env.AQR_SMOKE_URL;
  if (!base) {
    server = await startServer(path.join(work, "review"));
    base = server.base;
  }
  browser = await chromium.launch({ executablePath, headless: true });
  const context = await browser.newContext({
    acceptDownloads: true,
    extraHTTPHeaders: process.env.AQR_SMOKE_TOKEN
      ? { "x-aqr-token": process.env.AQR_SMOKE_TOKEN }
      : {},
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));

  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Importer dans l’atelier/ }).waitFor();
  ok("page chargée");

  await page.locator('input[type="file"]').first().setInputFiles(audio);
  const created = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/sessions" &&
      r.request().method() === "POST",
  );
  await page.getByRole("button", { name: /Importer dans l’atelier/ }).click();
  const creation = await created;
  assert(creation.status() === 201, `import refusé (${creation.status()})`);
  const sessionId = (await creation.json()).id;
  const run = page.getByRole("button", {
    name: /Lancer le vrai moteur Python/,
  });
  await run.waitFor({ timeout: 60_000 });
  ok(`audio importé (session ${sessionId})`);

  await run.click();
  const detail = await waitForSession({
    timeoutMs,
    fetchDetail: async () => {
      const res = await context.request.get(
        `${base}/api/sessions/${sessionId}`,
      );
      assert(res.ok(), `GET session : ${res.status()}`);
      return res.json();
    },
  });
  const result = detail.result;
  ok("moteur terminé (session done)");

  // I1 : texte et plage de mots de TOUS les versets nommés = corpus (fonction partagée avec
  // le smoke CLI) ; I3 : uniquement la sourate attendue ; au moins un RECOGNIZED.
  const corpus = await runPython(
    [
      "-m",
      "tests.support.corpus_check",
      "--surah",
      surah,
      "--min-recognized",
      "1",
      // audio de versets entiers (celui de smoke_e2e.sh) : plage jusqu'au dernier mot
      ...(process.env.AQR_SMOKE_COMPLETE === "0" ? [] : ["--complete"]),
      "-",
    ],
    { input: JSON.stringify(result) },
  );
  assert(
    corpus.code === 0,
    `résultat différent du corpus : ${corpus.stderr.trim() || corpus.stdout.trim()}`,
  );
  ok(corpus.stdout.trim());

  // Chaque verset RECOGNIZED de la sourate : le segment cliqué affiche le statut « Reconnu » et
  // un texte arabe strictement égal à interval.text (donc au corpus, vérifié ci-dessus).
  const recognized = recognizedSegments(result, surah);
  assert(
    recognized.length > 0,
    `aucun verset RECOGNIZED de la sourate ${surah} à afficher`,
  );
  for (const { index, interval } of recognized) {
    await page.locator(`button.segment[data-index="${index}"]`).click();
    const card = page.locator(".verse-card");
    // La carte suit l'événement « seeked » du lecteur : on attend la bonne référence au lieu de
    // lire aussitôt le passage précédent.
    const prefix = `${interval.ref} ·`;
    await page
      .waitForFunction(
        (expected) =>
          document
            .querySelector(".verse-card .ref")
            ?.textContent?.trim()
            .startsWith(expected),
        prefix,
        { timeout: 15_000 },
      )
      .catch(async () => {
        const shownRef = (await card.locator(".ref").innerText()).trim();
        throw new Error(
          `référence affichée « ${shownRef} » au lieu de ${interval.ref}`,
        );
      });
    const badges = await card.locator(".badges").innerText();
    assert(
      /Reconnu/.test(badges),
      `${interval.ref} : badge « ${badges} » sans « Reconnu »`,
    );
    assert(
      !interval.partial || /Passage partiel/.test(badges),
      `${interval.ref} : verset partiel sans badge « Passage partiel » (${badges})`,
    );
    const arabic = (await card.locator(".arabic").textContent())?.trim();
    assert(
      arabic === interval.text.trim(),
      `${interval.ref} : texte affiché « ${arabic} » ≠ interval.text « ${interval.text} »`,
    );
  }
  ok(
    `${recognized.length} verset(s) RECOGNIZED de la sourate ${surah} affichés = interval.text`,
  );

  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.locator("a.export").click();
  const file = await download;
  const zipPath = path.join(work, "bundle.zip");
  await file.saveAs(zipPath);
  const verified = await runPython([
    "-m",
    "scripts.verify_review_bundle",
    zipPath,
    "--source",
    audio,
    "--session-id",
    sessionId,
  ]);
  assert(
    verified.code === 0,
    `pack ZIP invalide : ${verified.stderr.trim() || verified.stdout.trim()}`,
  );
  const packed = (await readFile(zipPath)).length;
  ok(`pack ZIP vérifié (${packed} octets) : ${verified.stdout.trim()}`);

  assert(
    consoleErrors.length === 0,
    `erreurs page : ${consoleErrors.join(" | ")}`,
  );
  ok("aucune erreur JavaScript de page");
} catch (error) {
  failure = error;
} finally {
  await browser?.close().catch(() => {});
  server?.child.kill();
  await rm(work, { recursive: true, force: true });
}
if (failure) {
  console.error(`FAIL browser-smoke : ${failure.message}`);
  process.exit(1);
}
console.log(`PASS browser-smoke (${steps.length} étapes)`);
