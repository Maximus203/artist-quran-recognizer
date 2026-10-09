#!/usr/bin/env node
/**
 * Smoke navigateur de l'atelier : import d'un audio -> moteur réel -> sourate + verset
 * affichés -> export du pack ZIP. Aucun audio dans Git : le fichier vient de
 * AQR_SMOKE_AUDIO (par ex. produit par scripts/smoke_e2e.sh). Absent => SKIP (code 0).
 *
 * Variables :
 *   AQR_SMOKE_AUDIO     audio à importer (obligatoire, sinon SKIP)
 *   AQR_SMOKE_SURAH     sourate attendue (défaut 112)
 *   AQR_SMOKE_CHROMIUM  exécutable Chromium (défaut /opt/pw-browsers/chromium s'il existe)
 *   AQR_SMOKE_URL       serveur déjà lancé ; sinon `next start` est lancé (npm run build requis)
 *   AQR_SMOKE_TOKEN     jeton d'accès si le serveur est en mode test distant
 *   AQR_SMOKE_TIMEOUT_S délai max du moteur (défaut 900)
 * Le moteur lit AQR_PYTHON, AQR_MODELS_DIR, AQR_CORPUS_DIR et AQR_ASR (défaut ici : whisper).
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const audio = process.env.AQR_SMOKE_AUDIO;
if (!audio || !existsSync(audio)) {
  console.log("SKIP browser-smoke : AQR_SMOKE_AUDIO absent ou introuvable.");
  process.exit(0);
}
const surah = process.env.AQR_SMOKE_SURAH || "112";
const timeoutMs = Number(process.env.AQR_SMOKE_TIMEOUT_S || 900) * 1000;
const defaultChromium = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.AQR_SMOKE_CHROMIUM ||
  (existsSync(defaultChromium) ? defaultChromium : undefined);

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
      env: {
        ...process.env,
        AQR_REVIEW_DIR: reviewDir,
        AQR_ASR: process.env.AQR_ASR || "whisper",
      },
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
  await page.getByRole("button", { name: /Importer dans l’atelier/ }).click();
  const run = page.getByRole("button", {
    name: /Lancer le vrai moteur Python/,
  });
  await run.waitFor({ timeout: 60_000 });
  ok("audio importé (session créée)");

  await run.click();
  await page
    .getByRole("button", { name: /Arrêter le traitement/ })
    .waitFor({ timeout: 30_000 });
  ok("moteur lancé");

  const segment = page.locator(`button.segment:has-text("${surah}:")`).first();
  await segment.waitFor({ timeout: timeoutMs });
  await segment.click();
  ok("résultat du moteur affiché");

  const ref = (
    await page.locator(".verse-card .ref").first().innerText()
  ).trim();
  assert(
    new RegExp(`^${surah}:[1-9]\\d*`).test(ref),
    `référence inattendue : « ${ref} » (sourate ${surah} attendue)`,
  );
  const arabic = await page.locator(".verse-card .arabic").first().innerText();
  assert(/[؀-ۿ]{3,}/.test(arabic), "texte arabe absent de la carte");
  ok(`sourate ${surah} + verset affichés (${ref})`);

  const download = page.waitForEvent("download", { timeout: 120_000 });
  await page.locator("a.export").click();
  const file = await download;
  const zipPath = path.join(work, "bundle.zip");
  await file.saveAs(zipPath);
  const zip = await readFile(zipPath);
  assert(zip.subarray(0, 2).toString() === "PK", "le pack n'est pas un ZIP");
  const names = zip.toString("latin1");
  for (const needle of ["manifest", "prediction", "source"])
    assert(names.includes(needle), `entrée « ${needle} » absente du ZIP`);
  ok(`pack ZIP exporté (${zip.length} octets, manifeste + prédiction + audio)`);

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
