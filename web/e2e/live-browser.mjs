#!/usr/bin/env node
/**
 * Preuve de l'écran « En direct » dans un VRAI navigateur (Chrome, micro simulé par un fichier de
 * récitation joué en temps réel). Build de production seulement (`next build` + `next start`), jamais
 * `next dev`. Aucun succès muet : une ressource absente est un ÉCHEC (code 2).
 *
 *   node e2e/live-browser.mjs nominal   --clip fatiha-alafasy --width 1280 --scheme dark
 *   node e2e/live-browser.mjs cut       --clip fatiha-alafasy       (coupure réseau puis reprise)
 *   node e2e/live-browser.mjs token                                 (jeton expiré, rejoué)
 *   node e2e/live-browser.mjs nomic | deny                          (pas de micro, micro refusé)
 *   node e2e/live-browser.mjs busy                                  (service plein : server_busy)
 *   node e2e/live-browser.mjs pause --clip fatiha-alafasy           (pause longue, trames de silence)
 *
 * Variables :
 *   AQR_SMOKE_URL        atelier (build de production déjà lancé)
 *   AQR_LIVE_CLIPS       dossier des clips (<nom>.wav + <nom>.json, voir make_clips.py)
 *   AQR_LIVE_OUT         dossier des captures et du JSON de mesures
 *   AQR_LIVE_KEY         clé de signature (pour fabriquer des jetons de test : expiré, plein)
 *   AQR_LIVE_SERVICE     adresse HTTP du service (défaut http://127.0.0.1:8765)
 *   AQR_LIVE_PROXY_CTL   contrôle du relais de coupure (défaut http://127.0.0.1:8767)
 *   AQR_SMOKE_USER / AQR_SMOKE_PASSWORD  compte de test ; sans eux, un compte jetable est inscrit
 */
import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const scenario = args[0] ?? "nominal";
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const base = process.env.AQR_SMOKE_URL;
if (!base) {
  console.error("ÉCHEC : AQR_SMOKE_URL absent (atelier de production requis).");
  process.exit(2);
}
const clipsDir = process.env.AQR_LIVE_CLIPS ?? "";
const out = process.env.AQR_LIVE_OUT ?? path.resolve("live-proof");
const service = process.env.AQR_LIVE_SERVICE ?? "http://127.0.0.1:8765";
const proxyCtl = process.env.AQR_LIVE_PROXY_CTL ?? "http://127.0.0.1:8767";
const clipName = opt("clip", "fatiha-alafasy");
const width = Number(opt("width", 1280));
const height = Number(opt("height", width < 768 ? 812 : 900));
const scheme = opt("scheme", "dark");
const tag = opt("tag", `${scenario}-${width}-${scheme}`);
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = () => {
  const wav = path.join(clipsDir, `${clipName}.wav`);
  const meta = JSON.parse(
    readFileSync(path.join(clipsDir, `${clipName}.json`), "utf-8"),
  );
  return { wav, meta };
};

// ───────── Chrome et page ─────────
async function launch({ mic = "fake", wav } = {}) {
  const flags = [];
  if (mic === "fake") {
    flags.push(
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${wav}%noloop`,
    );
  } else if (mic === "deny") {
    flags.push(
      "--use-fake-device-for-media-stream",
      "--deny-permission-prompts",
    );
  }
  return chromium.launch({ channel: "chrome", headless: true, args: flags });
}

const PROBE = () => {
  const probe = (window.__aqr = {
    ws: [],
    marks: [],
    stage: [],
    chunks: [],
    samples: 0,
    rate: 0,
    sentBytes: 0,
    sentFrames: 0,
    zeroFrames: 0,
  });
  const NativeWS = window.WebSocket;
  window.WebSocket = class extends NativeWS {
    constructor(...a) {
      super(...a);
      this.addEventListener("open", () =>
        probe.marks.push({
          w: performance.now(),
          what: "ws-open",
          url: String(a[0]),
        }),
      );
      this.addEventListener("close", (e) =>
        probe.marks.push({
          w: performance.now(),
          what: "ws-close",
          code: e.code,
        }),
      );
      this.addEventListener("message", (e) => {
        if (typeof e.data !== "string") return;
        try {
          const m = JSON.parse(e.data);
          probe.ws.push({
            w: performance.now(),
            type: m.type,
            seq: m.seq,
            t: m.t,
            raw: e.data,
            ref: m.ref ?? m.interval?.ref ?? m.closed?.ref ?? null,
            status: m.interval?.status ?? m.closed?.status ?? null,
            count: m.count ?? null,
            words_heard: m.words_heard ?? m.interval?.words_heard ?? null,
            code: m.code ?? null,
            resumed: m.resumed ?? null,
            words: m.interval?.words ?? null,
            text_words: m.interval?.text
              ? m.interval.text.split(/\s+/).length
              : null,
          });
        } catch {
          /* message illisible : sans objet pour la mesure */
        }
      });
    }
    send(data) {
      if (typeof data === "string") {
        try {
          const m = JSON.parse(data);
          probe.marks.push({
            w: performance.now(),
            what: `send-${m.type}`,
            resume: !!m.resume,
          });
        } catch {
          /* ignoré */
        }
      } else {
        probe.sentBytes += data.byteLength;
        probe.sentFrames += 1;
        const view = new Uint8Array(
          data.buffer ?? data,
          data.byteOffset ?? 0,
          data.byteLength,
        );
        if (view.every((b) => b === 0)) probe.zeroFrames += 1;
      }
      return super.send(data);
    }
  };
  const NativeNode = window.AudioWorkletNode;
  if (NativeNode) {
    window.AudioWorkletNode = class extends NativeNode {
      constructor(ctx, ...rest) {
        super(ctx, ...rest);
        probe.rate = ctx.sampleRate;
        this.port.addEventListener("message", (e) => {
          const d = e.data;
          if (!d || !d.length) return;
          let sum = 0;
          for (let i = 0; i < d.length; i += 1) sum += d[i] * d[i];
          probe.samples += d.length;
          probe.chunks.push({
            w: performance.now(),
            n: d.length,
            rms: Math.sqrt(sum / d.length),
          });
        });
        this.port.start();
      }
    };
  }
  const snap = () => {
    const s = document.querySelector('[data-testid="live-stage"]');
    const end = document.querySelector('[data-testid="live-end"]');
    if (!s && !end) return null;
    return {
      view: s ? s.dataset.view : "end",
      ref: s?.querySelector('[data-testid="live-ref"]')?.textContent ?? null,
      count:
        s?.querySelector('[data-testid="live-cand-count"]')?.textContent ??
        null,
      heard:
        s?.querySelector('[data-testid="live-words-heard"]')?.textContent ??
        null,
      patience:
        s?.querySelector('[data-testid="live-patience"]')?.dataset.stage ??
        null,
    };
  };
  let last = "";
  const watch = () => {
    new MutationObserver(() => {
      const x = snap();
      const k = JSON.stringify(x);
      if (k !== last) {
        last = k;
        probe.stage.push({ w: performance.now(), ...x });
      }
    }).observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", watch);
  else watch();
};

async function newPage(
  browser,
  {
    w = width,
    h = height,
    colorScheme = scheme,
    permissions = ["microphone"],
    mediaError = null,
  } = {},
) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    colorScheme,
    permissions,
    deviceScaleFactor: 1,
  });
  await context.addInitScript(PROBE);
  if (mediaError)
    // Erreur du navigateur simulée (aucun micro de cette machine de test n'est vraiment absent).
    await context.addInitScript((name) => {
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException("simulé par le test", name));
    }, mediaError);
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning")
      problems.push(`${m.type()}: ${m.text()}`);
  });
  page.on("requestfailed", (r) => {
    // Les préchargements de page annulés par la navigation (ERR_ABORTED) ne sont pas des échecs.
    if (r.failure()?.errorText !== "net::ERR_ABORTED")
      problems.push(
        `requestfailed: ${r.method()} ${r.url()} ${r.failure()?.errorText}`,
      );
  });
  return { context, page, problems };
}

async function signIn(page) {
  // Atelier derrière le tunnel (mode test distant protégé) : le jeton d'accès d'abord.
  if (process.env.AQR_ACCESS_TOKEN) {
    await page.goto(`${base}/access`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Jeton d’accès").fill(process.env.AQR_ACCESS_TOKEN);
    await page.getByRole("button", { name: "Entrer" }).click();
    await page.waitForLoadState("domcontentloaded");
  }
  const user = process.env.AQR_SMOKE_USER;
  const password = process.env.AQR_SMOKE_PASSWORD;
  if (user && password) {
    await page.goto(`${base}/login`, { waitUntil: "networkidle" }); // hydraté avant de saisir : un envoi natif mettrait le mot de passe dans l’adresse
    await page.getByLabel("Pseudonyme").fill(user);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    await page.getByTestId("login-submit").click();
  } else {
    await page.goto(`${base}/register`, { waitUntil: "networkidle" });
    await page
      .getByLabel("Pseudonyme")
      .fill(`direct-${randomBytes(4).toString("hex")}`);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(`${randomBytes(12).toString("base64url")}-aA1`);
    await page.getByTestId("register-submit").click();
  }
  await page.getByTestId("new-trial").waitFor({ timeout: 30_000 });
}

const shot = async (page, name) => {
  const file = path.join(out, `${tag}-${name}.png`);
  await page.screenshot({ path: file });
  return file;
};
const audioSeconds = (page) =>
  page.evaluate(() =>
    window.__aqr.rate ? window.__aqr.samples / window.__aqr.rate : 0,
  );
const view = (page) =>
  page.evaluate(
    () =>
      document.querySelector('[data-testid="live-stage"]')?.dataset.view ??
      (document.querySelector('[data-testid="live-end"]') ? "end" : null),
  );
const waitView = (page, wanted, timeout = 90_000) =>
  page.waitForFunction(
    (v) => {
      const el = document.querySelector('[data-testid="live-stage"]');
      const now = el
        ? el.dataset.view
        : document.querySelector('[data-testid="live-end"]')
          ? "end"
          : null;
      return Array.isArray(v) ? v.includes(now) : now === v;
    },
    wanted,
    { timeout, polling: 50 },
  );

// ───────── Mesures ─────────
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const p90 = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
};
const round = (x) => (x === null ? null : Math.round(x));

/**
 * Horloge AUDIO : secondes d'audio reçues par l'application à l'instant `w` (horloge de la page). Le micro
 * simulé de Chrome ne tourne pas exactement en temps réel sur cette machine (mesuré : environ 0,8 fois la
 * vitesse), donc le délai voix -> écran se mesure en secondes d'AUDIO écoulées depuis le début de la voix,
 * ce qui est ce qu'un vrai micro (horloge = temps réel) donnerait.
 */
function audioClock(probe) {
  const times = [];
  const cumulative = [];
  let total = 0;
  for (const c of probe.chunks) {
    total += c.n;
    times.push(c.w);
    cumulative.push(total);
  }
  return (w) => {
    if (!times.length || w < times[0]) return 0;
    let lo = 0;
    let hi = times.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (times[mid] <= w) lo = mid;
      else hi = mid - 1;
    }
    return cumulative[lo] / probe.rate;
  };
}

/** Instant audio (s) où la première voix de la récitation arrive dans l'application. */
function firstVoiceAudioS(probe) {
  let total = 0;
  for (const c of probe.chunks) {
    if (c.rms > 0.012) return total / probe.rate;
    total += c.n;
  }
  return null;
}

function verseDelays(probe, meta) {
  const first = firstVoiceAudioS(probe);
  if (first === null) return { error: "aucune voix reçue par le navigateur" };
  const clock = audioClock(probe);
  const voiceAt = (v) =>
    first + (v.voice_start_s - meta.verses[0].voice_start_s);
  // Un message est rattaché au verset dont la voix a commencé avant lui (fenêtre : jusqu'à la voix suivante).
  const within = (w, lo, hi) => clock(w) >= lo - 0.2 && clock(w) < hi;
  const delay = (w, voice) => round((clock(w) - voice) * 1000);
  const rows = [];
  for (const [i, v] of meta.verses.entries()) {
    const voice = voiceAt(v);
    const nextVoice = meta.verses[i + 1]
      ? voiceAt(meta.verses[i + 1])
      : Infinity;
    const cand = probe.ws.find(
      (m) => m.type === "CANDIDATES" && within(m.w, voice, nextVoice),
    );
    const lock = probe.ws.find(
      (m) =>
        m.type === "LOCKED" &&
        m.ref === v.ref &&
        within(m.w, voice, nextVoice + 8),
    );
    const domCand = probe.stage.find(
      (s) => s.view === "cands" && within(s.w, voice, nextVoice),
    );
    const domNamed = probe.stage.find(
      (s) =>
        (s.view === "named" || s.view === "inferred") &&
        s.ref?.endsWith(v.ref) &&
        within(s.w, voice, nextVoice + 8),
    );
    rows.push({
      ref: v.ref,
      voice_s: v.voice_start_s,
      candidates_ms: cand ? delay(cand.w, voice) : null,
      locked_ms: lock ? delay(lock.w, voice) : null,
      locked_status: lock?.status ?? null,
      first_name_on_screen_ms: domNamed ? delay(domNamed.w, voice) : null,
      // Rendu : horloge murale (le temps entre l'arrivée du message et l'image), pas l'audio.
      screen_after_message_ms:
        domNamed && lock ? round(domNamed.w - lock.w) : null,
      first_cands_on_screen_ms: domCand ? delay(domCand.w, voice) : null,
    });
  }
  const named = rows.filter((r) => r.first_name_on_screen_ms !== null);
  const lockedMs = rows.map((r) => r.locked_ms).filter((x) => x !== null);
  const screenMs = named.map((r) => r.first_name_on_screen_ms);
  const candMs = rows
    .map((r) => r.first_cands_on_screen_ms)
    .filter((x) => x !== null);
  const renderMs = named
    .map((r) => r.screen_after_message_ms)
    .filter((x) => x !== null);
  const lockedRefs = probe.ws
    .filter((m) => m.type === "LOCKED")
    .map((m) => m.ref);
  const wanted = new Set(meta.verses.map((v) => v.ref));
  return {
    rows,
    verses: rows.length,
    named: named.length,
    not_named: rows.length - named.length,
    false_named: lockedRefs.filter((r) => !wanted.has(r)),
    candidates_on_screen_ms: {
      median: round(median(candMs)),
      p90: round(p90(candMs)),
      n: candMs.length,
    },
    name_on_screen_ms: {
      median: round(median(screenMs)),
      p90: round(p90(screenMs)),
      n: screenMs.length,
    },
    name_message_ms: {
      median: round(median(lockedMs)),
      p90: round(p90(lockedMs)),
      n: lockedMs.length,
    },
    screen_after_message_ms: {
      median: round(median(renderMs)),
      p90: round(p90(renderMs)),
      max: renderMs.length ? Math.max(...renderMs) : null,
    },
  };
}

// ───────── Scénarios ─────────
const results = {
  scenario,
  tag,
  base,
  width,
  height,
  scheme,
  checks: [],
  shots: [],
};
const check = (name, ok, detail = "") => {
  results.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const keepShot = async (page, name) => {
  results.shots.push(path.basename(await shot(page, name)));
};

async function playClip(page, meta, { onNamedShot = true } = {}) {
  await page.getByTestId("live-start").click();
  await waitView(page, ["listen", "cands", "named", "between"], 30_000);
  await keepShot(page, "ecoute");
  let shotCands = false;
  let shotNamed = false;
  // On laisse finir la récitation en secondes d'AUDIO reçues (le micro simulé n'est pas exactement en temps
  // réel), avec un plafond mural large.
  const wallEnd = Date.now() + (meta.total_s * 1.8 + 25) * 1000;
  while (
    Date.now() < wallEnd &&
    (await audioSeconds(page)) < meta.total_s + 6
  ) {
    const v = await view(page);
    if (v === "cands" && !shotCands) {
      shotCands = true;
      await keepShot(page, "candidats");
    }
    if ((v === "named" || v === "inferred") && !shotNamed && onNamedShot) {
      shotNamed = true;
      await sleep(900);
      await keepShot(page, "nomme");
    }
    await sleep(120);
  }
  return { shotCands, shotNamed };
}

async function stopAndEnd(page) {
  await page.getByTestId("live-stop").click();
  await waitView(page, "end", 40_000);
  await sleep(300);
}

async function nominal() {
  const { wav, meta } = clip();
  const browser = await launch({ wav });
  const { context, page, problems } = await newPage(browser);
  try {
    await signIn(page);
    await page.goto(`${base}/direct`, { waitUntil: "networkidle" });
    check("page /direct ouverte, état Prêt", (await view(page)) === "idle");
    await keepShot(page, "pret");
    const t = Date.now();
    const { shotCands, shotNamed } = await playClip(page, meta);
    check("des candidats sont apparus PENDANT la lecture", shotCands);
    check("un verset nommé est apparu PENDANT la lecture", shotNamed);
    await stopAndEnd(page);
    await keepShot(page, "fin");
    const probe = await page.evaluate(() => window.__aqr);
    const delays = verseDelays(probe, meta);
    results.delays = delays;
    // Santé de la capture : le micro simulé doit livrer des blocs réguliers, en temps réel.
    const chunks = probe.chunks;
    const gaps = chunks.slice(1).map((c, i) => c.w - chunks[i].w);
    results.capture = {
      sample_rate: probe.rate,
      chunks: chunks.length,
      audio_s: Math.round(chunks.reduce((n, c) => n + c.n, 0) / probe.rate),
      wall_s: chunks.length
        ? Math.round((chunks[chunks.length - 1].w - chunks[0].w) / 1000)
        : 0,
      max_gap_ms: gaps.length ? Math.round(Math.max(...gaps)) : null,
      gaps_over_100ms: gaps.filter((g) => g > 100).length,
    };
    // Les messages réels du service, dans l'ordre : de quoi rejouer cette écoute en test.
    results.messages = probe.ws.map((m) => m.raw);
    results.elapsed_s = Math.round((Date.now() - t) / 1000);
    check(
      "aucun faux verset nommé (I3)",
      delays.false_named?.length === 0,
      JSON.stringify(delays.false_named),
    );
    // La part de versets nommés est la qualité du moteur (65 % sur le banc), pas celle de l'écran :
    // elle est rapportée, et seul « au moins un nom à l'écran » est exigé.
    check(
      "au moins un verset nommé à l'écran",
      delays.named >= 1,
      `${delays.named}/${delays.verses} nommés`,
    );
    // I3 : jamais de traduction ni de nom pendant l'état « candidats » sans traduction commune.
    const bad = probe.stage.filter((s) => s.view === "cands" && s.ref);
    check("pas de nom de verset pendant l'état candidats", bad.length === 0);
    const facts = await page.getByTestId("live-facts").innerText();
    results.facts = facts;
    check(
      "la fin d'écoute donne le résumé honnête",
      /nommé/.test(facts),
      facts.replace(/\n/g, " · "),
    );
    const kept = await page.getByTestId("live-keep").count();
    check(
      "« Garder cet enregistrement » est proposé (son en mémoire du navigateur)",
      kept === 1,
    );
    const sentS = probe.sentBytes / 32000;
    const capturedS = probe.samples / probe.rate;
    check(
      "tout l'audio capté est envoyé (16 kHz mono 16 bits, aucune perte)",
      Math.abs(sentS - capturedS) <= 0.03 * capturedS + 0.5,
      `${sentS.toFixed(1)} s envoyées pour ${capturedS.toFixed(1)} s captées`,
    );
    check(
      "la récitation entière a été captée",
      capturedS >= meta.total_s,
      `${capturedS.toFixed(1)} s captées, clip de ${meta.total_s} s`,
    );
    const zero = probe.zeroFrames;
    results.zero_frames = zero;
    // Scroll horizontal
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    check("aucun défilement horizontal", overflow <= 0, `${overflow}px`);
    results.problems = problems.filter(
      (p) => !/Download the React DevTools/.test(p),
    );
    check(
      "console propre (aucune erreur)",
      results.problems.length === 0,
      results.problems.slice(0, 3).join(" | "),
    );
    results.ws_messages = probe.ws.length;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function cut() {
  const { wav, meta } = clip();
  const browser = await launch({ wav });
  const { context, page, problems } = await newPage(browser);
  try {
    await signIn(page);
    await page.goto(`${base}/direct`, { waitUntil: "networkidle" });
    await page.getByTestId("live-start").click();
    await waitView(page, ["listen", "cands", "named", "between"], 30_000);
    // Coupe au bon moment : en plein verset, après le premier nom.
    await waitView(page, ["named", "between"], 60_000);
    await sleep(1500);
    const cutAt = Date.now();
    await fetch(`${proxyCtl}/cut?block_ms=9000`, { method: "POST" });
    await page.getByTestId("live-retry-now").waitFor({ timeout: 15_000 });
    check("la coupure est dite en clair (bandeau + son gardé)", true);
    await sleep(2500);
    await keepShot(page, "coupure");
    const text = await page.getByTestId("live-notice").innerText();
    check(
      "le bandeau dit que le son est gardé",
      /garde le son/.test(text),
      text.replace(/\n/g, " ").slice(0, 160),
    );
    await page.getByText("Connexion rétablie").waitFor({ timeout: 40_000 });
    results.recovered_after_s = Math.round((Date.now() - cutAt) / 100) / 10;
    await keepShot(page, "reprise");
    check(
      "reprise automatique, connexion rétablie",
      true,
      `${results.recovered_after_s} s après la coupure`,
    );
    // La suite de la récitation arrive : on laisse finir le clip.
    const wallEnd = Date.now() + (meta.total_s * 1.8 + 25) * 1000;
    while (
      Date.now() < wallEnd &&
      (await audioSeconds(page)) < meta.total_s + 6
    )
      await sleep(250);
    await stopAndEnd(page);
    await keepShot(page, "fin");
    const probe = await page.evaluate(() => window.__aqr);
    const resumeStart = probe.marks.find(
      (m) => m.what === "send-START" && m.resume,
    );
    check(
      "la reprise a présenté la session (START avec resume)",
      !!resumeStart,
    );
    const ready = probe.ws.filter((m) => m.type === "READY");
    check(
      "le service a répondu READY resumed=true",
      ready.some((m) => m.resumed === true),
    );
    const locked = probe.ws
      .filter((m) => m.type === "LOCKED")
      .map((m) => m.ref);
    const wanted = new Set(meta.verses.map((v) => v.ref));
    check(
      "aucun faux verset nommé après la reprise (I3)",
      locked.every((r) => wanted.has(r)),
      locked.join(","),
    );
    const seqs = probe.ws.filter((m) => m.seq > 0).map((m) => m.seq);
    check(
      "aucun message en double (seq strictement croissant, rejeu compris)",
      new Set(seqs).size === seqs.length,
      `${seqs.length} messages`,
    );
    const facts = await page.getByTestId("live-facts").innerText();
    results.facts = facts;
    results.locked = locked;
    results.cut = {
      closes: probe.marks.filter((m) => m.what === "ws-close").length,
      opens: probe.marks.filter((m) => m.what === "ws-open").length,
      sent_s: Math.round(probe.sentBytes / 32000),
      clip_s: meta.total_s,
    };
    check(
      "tout le son a été renvoyé (aucun trou)",
      probe.sentBytes >= meta.total_s * 32000 * 0.9,
      JSON.stringify(results.cut),
    );
    results.problems = problems.filter(
      (p) =>
        !/Download the React DevTools|WebSocket connection to .* failed|ERR_/.test(
          p,
        ),
    );
    check(
      "console propre hors coupure volontaire",
      results.problems.length === 0,
      results.problems.slice(0, 3).join(" | "),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

const b64 = (x) => Buffer.from(x).toString("base64url");
function mint({
  key,
  sub,
  ttl = 60,
  now = Date.now(),
  jti = b64(randomBytes(16)),
}) {
  const iat = Math.floor(now / 1000);
  const body = b64(
    JSON.stringify({
      aud: "aqr.live/1",
      sub,
      jti,
      iat,
      exp: iat + ttl,
      tech: false,
    }),
  );
  const sig = createHmac("sha256", `${key}`)
    .update(`aqr.live.token/1.${body}`)
    .digest("base64url");
  return `v1.${body}.${sig}`;
}

async function token() {
  const key = process.env.AQR_LIVE_KEY;
  if (!key) throw new Error("AQR_LIVE_KEY absent");
  const { wav, meta } = clip();
  const browser = await launch({ wav });
  const { context, page } = await newPage(browser);
  try {
    await signIn(page);
    await page.goto(`${base}/direct`, { waitUntil: "networkidle" });
    // 1. Jeton expiré à chaque demande : une reprise automatique, puis l'erreur dite en clair.
    let calls = 0;
    await page.route("**/api/live/token", (route) => {
      calls += 1;
      route.fulfill({
        json: {
          schema: "aqr.live/1",
          token: mint({ key, sub: "1", now: Date.now() - 180_000 }),
          expires_at: new Date().toISOString(),
          ttl_s: 60,
          url: "ws://127.0.0.1:8765/live",
          technical: false,
        },
      });
    });
    await page.getByTestId("live-start").click();
    await waitView(page, "err", 30_000);
    const text = await page.getByTestId("live-stage").innerText();
    await keepShot(page, "jeton-expire");
    check(
      "jeton expiré : l'erreur s'explique (cause, impact, quoi faire)",
      /Pourquoi/.test(text) && /Que faire/.test(text),
      text.replace(/\n/g, " ").slice(0, 200),
    );
    check(
      "un seul nouvel essai automatique avec un jeton neuf (2 demandes)",
      calls === 2,
      `${calls} demandes`,
    );
    check(
      "le message ne montre aucun code brut",
      !/token_|AQR_|undefined/.test(text),
    );
    // 2. Le vrai jeton ensuite : « Réessayer » démarre.
    await page.unroute("**/api/live/token");
    await page.getByTestId("live-start").click();
    await waitView(page, ["listen", "cands", "named", "between"], 30_000);
    check("« Réessayer » avec un vrai jeton démarre l'écoute", true);
    await sleep(2500);
    await page.getByTestId("live-stop").click();
    await waitView(page, "end", 40_000);
    void meta;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function micRefused(kind) {
  // « deny » : vrai refus du navigateur (--deny-permission-prompts, aucune permission accordée) ;
  // « none » / « micbusy » : l'erreur du navigateur est simulée (NotFoundError / NotReadableError).
  const browser = await launch({ mic: kind === "deny" ? "deny" : "none" });
  const { context, page, problems } = await newPage(browser, {
    permissions: kind === "deny" ? [] : ["microphone"],
    mediaError:
      kind === "none"
        ? "NotFoundError"
        : kind === "micbusy"
          ? "NotReadableError"
          : null,
  });
  try {
    await signIn(page);
    await page.goto(`${base}/direct`, { waitUntil: "networkidle" });
    await page.getByTestId("live-start").click();
    await waitView(page, "err", 20_000);
    const text = await page.getByTestId("live-stage").innerText();
    await keepShot(page, `micro-${kind}`);
    const wanted =
      kind === "deny"
        ? /bloqué/
        : kind === "micbusy"
          ? /déjà utilisé/
          : /Aucun micro/;
    check(
      `micro (${kind}) : écran dédié`,
      wanted.test(text),
      text.replace(/\n/g, " ").slice(0, 160),
    );
    check(
      "cause, impact et quoi faire sont dits",
      /Pourquoi/.test(text) &&
        /Ce que ça change/.test(text) &&
        /Que faire/.test(text),
    );
    const probe = await page.evaluate(() => window.__aqr);
    check(
      "aucune connexion n'a été ouverte (rien n'est parti)",
      probe.marks.every((m) => m.what !== "ws-open"),
    );
    const alert = await page.getByRole("alert").count();
    check("l'écran d'erreur bloquant est une alerte (role=alert)", alert >= 1);
    results.problems = problems;
  } finally {
    await context.close();
    await browser.close();
  }
}

async function busy() {
  const key = process.env.AQR_LIVE_KEY;
  if (!key) throw new Error("AQR_LIVE_KEY absent");
  const { wav, meta } = clip();
  // Occupe tous les flux du service avec des clients de test (jetons fabriqués, un compte chacun).
  const health = await (await fetch(`${service}/health`)).json();
  const holders = [];
  const free = health.capacity - health.streams;
  for (let i = 0; i < free; i += 1) {
    const ws = new WebSocket(`${service.replace("http", "ws")}/live`);
    ws.binaryType = "arraybuffer";
    await new Promise((resolve, reject) => {
      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: "START",
            schema: "aqr.live/1",
            token: mint({ key, sub: `holder-${i}` }),
            audio: { encoding: "pcm_s16le", sample_rate: 16000, channels: 1 },
            options: { translation: "none" },
          }),
        );
      };
      ws.onmessage = (e) => {
        if (String(e.data).includes('"READY"')) resolve();
      };
      ws.onerror = () => reject(new Error("client de test refusé"));
    });
    holders.push(ws);
  }
  const keepAlive = setInterval(
    () =>
      holders.forEach((w) => w.readyState === 1 && w.send(new Uint8Array(640))),
    1000,
  );
  const browser = await launch({ wav });
  const { context, page } = await newPage(browser);
  try {
    await signIn(page);
    await page.goto(`${base}/direct`, { waitUntil: "networkidle" });
    const started = Date.now();
    await page.getByTestId("live-start").click();
    await waitView(page, "err", 30_000);
    const text = await page.getByTestId("live-stage").innerText();
    await keepShot(page, "service-complet");
    check(
      "service plein : écran 'service complet' avec le texte du service",
      /complet/.test(text) && /Message du service/.test(text),
      text.replace(/\n/g, " ").slice(0, 220),
    );
    check(
      "un nouvel essai automatique est annoncé",
      (await page.getByTestId("live-retry-in").count()) === 1,
    );
    // Libère les places : l'essai automatique doit aboutir sans geste.
    holders.forEach((w) => w.close(1000));
    await waitView(page, ["listen", "cands", "named", "between"], 60_000);
    results.auto_retry_after_s = Math.round((Date.now() - started) / 100) / 10;
    check(
      "l'essai automatique aboutit une fois la place libérée",
      true,
      `${results.auto_retry_after_s} s après le clic`,
    );
    await sleep(2000);
    await page.getByTestId("live-stop").click();
    await waitView(page, "end", 40_000);
    void meta;
  } finally {
    clearInterval(keepAlive);
    holders.forEach((w) => w.readyState < 2 && w.close(1000));
    await context.close();
    await browser.close();
  }
}

async function pause() {
  const { wav, meta } = clip();
  const browser = await launch({ wav });
  const { context, page } = await newPage(browser);
  try {
    await signIn(page);
    await page.goto(`${base}/direct`, { waitUntil: "networkidle" });
    await page.getByTestId("live-start").click();
    await waitView(page, ["listen", "cands", "named", "between"], 30_000);
    await sleep(3000);
    await page.getByTestId("live-pause").click();
    await page.getByTestId("live-resume").waitFor();
    await keepShot(page, "pause");
    const before = await page.evaluate(() => window.__aqr.sentBytes);
    const pausedFor = Number(opt("pause-s", 40));
    await sleep(pausedFor * 1000);
    const probe1 = await page.evaluate(() => window.__aqr);
    const sentDuring = probe1.sentBytes - before;
    check(
      "en pause, rien du micro n'est envoyé (que du silence très court)",
      probe1.zeroFrames > 0 && sentDuring < pausedFor * 32000 * 0.05,
      `${sentDuring} octets en ${pausedFor} s`,
    );
    const closes = probe1.marks.filter((m) => m.what === "ws-close").length;
    check(
      `la connexion survit à ${pausedFor} s de pause (au-delà du délai d'inactivité du service)`,
      closes === 0,
      `${closes} fermeture(s)`,
    );
    await page.getByTestId("live-resume").click();
    await page.getByTestId("live-pause").waitFor();
    await sleep(Math.min(20_000, meta.total_s * 300));
    await stopAndEnd(page);
    const probe2 = await page.evaluate(() => window.__aqr);
    check(
      "l'écoute reprend et se termine proprement",
      probe2.ws.some((m) => m.type === "FINAL"),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

/**
 * Mode allégé et correction : le service ne les émet pas encore en conditions normales (surcharge rare,
 * vérification acoustique non branchée en direct). Les deux messages sont donc INJECTÉS par le relais
 * de test, entre deux messages réels, pour éprouver l'écran dans un vrai navigateur. Ce n'est pas une
 * sortie du moteur : le rapport le dit.
 */
async function injected() {
  const { wav, meta } = clip();
  const browser = await launch({ wav });
  const { context, page } = await newPage(browser);
  const inject = (m) =>
    fetch(`${proxyCtl}/inject`, {
      method: "POST",
      body: JSON.stringify({ schema: "aqr.live/1", seq: 0, t: 0, ...m }),
    }).then((r) => r.json());
  try {
    await signIn(page);
    await page.goto(`${base}/direct`, { waitUntil: "networkidle" });
    await page.getByTestId("live-start").click();
    await waitView(page, "named", 90_000);
    await waitView(page, ["between", "cands", "listen", "unres"], 30_000);
    const probe = await page.evaluate(() => window.__aqr);
    const ref = probe.ws.filter((m) => m.type === "LOCKED").pop()?.ref;
    check("un verset a été nommé avant l'injection", !!ref, ref ?? "");
    const verses = () =>
      page.locator('[data-testid="live-hist"] li[data-kind="verse"]');
    const before = await verses().count();

    // 1. Mode allégé (surcharge) : bandeau permanent, puce, retard réel affiché.
    check(
      "injection DEGRADED reçue",
      (
        await inject({
          type: "DEGRADED",
          tier: 1,
          overloaded: true,
          lag_s: 5.3,
          skipped: [],
          reason: "overload",
        })
      ).injected,
    );
    await page.getByTestId("live-degraded").waitFor({ timeout: 5000 });
    const banner = await page.getByTestId("live-degraded").innerText();
    await keepShot(page, "allege");
    check(
      "le bandeau du mode allégé dit le retard et que les noms arrivent plus tard",
      /5,3 s de retard/.test(banner) && /plus tard/.test(banner),
      banner.replace(/\n/g, " ").slice(0, 200),
    );
    check(
      "la puce « Mode allégé » est affichée",
      (await page.getByTestId("live-status").innerText()).includes(
        "Mode allégé",
      ),
    );
    await sleep(2500);
    check(
      "le bandeau est permanent (toujours là 2,5 s plus tard)",
      (await page.getByTestId("live-degraded").count()) === 1,
    );

    // 2. Correction : la ligne reste, marquée « Corrigé », sans son texte.
    check(
      "injection REVISION reçue",
      (
        await inject({
          type: "REVISION",
          ref,
          status: "retracted",
          reason: "acoustic_check",
        })
      ).injected,
    );
    await page.getByTestId("live-revision").waitFor({ timeout: 5000 });
    const rev = await page.getByTestId("live-revision").innerText();
    await keepShot(page, "correction");
    check(
      "le bandeau « Correction » nomme le verset retiré",
      rev.includes(ref) || /Correction/.test(rev),
      rev.replace(/\n/g, " ").slice(0, 160),
    );
    check(
      "la ligne n'est pas effacée (même nombre de lignes)",
      (await verses().count()) === before,
      `${before} -> ${await verses().count()}`,
    );
    const row = page.locator(
      '[data-testid="live-hist"] li[data-revised="true"]',
    );
    check(
      "la ligne est marquée Corrigé",
      (await row.count()) === 1 && /Corrigé/.test(await row.innerText()),
    );
    await row.locator("summary").click();
    check(
      "le texte du verset retiré n'est plus affiché",
      (await row.locator(".ar").count()) === 0,
    );
    const announce = await page.getByTestId("live-announce").innerText();
    check(
      "la correction est annoncée aux lecteurs d'écran",
      /Correction/.test(announce) ||
        (await page.getByTestId("live-revision").getAttribute("role")) ===
          "status",
      announce,
    );

    // 3. Retour à la normale : le bandeau part, la trace reste dans la fin d'écoute.
    await inject({
      type: "DEGRADED",
      tier: 1,
      overloaded: false,
      lag_s: 0.2,
      skipped: [],
      reason: "recovered",
    });
    await page
      .getByTestId("live-degraded")
      .waitFor({ state: "detached", timeout: 5000 });
    check("retour au mode normal : le bandeau disparaît", true);
    await stopAndEnd(page);
    await keepShot(page, "fin-allege");
    const facts = await page.getByTestId("live-facts").innerText();
    check(
      "la fin d'écoute rappelle le mode allégé",
      /mode allégé/.test(facts),
      facts.replace(/\n/g, " "),
    );
    void meta;
  } finally {
    await context.close();
    await browser.close();
  }
}

/** « Garder cet enregistrement » (import classique, source microphone) et « Ne rien garder » (annulable). */
async function keep() {
  const { wav, meta } = clip();
  const browser = await launch({ wav });
  const { context, page } = await newPage(browser);
  const calls = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/sessions?"))
      calls.push({ method: r.method(), url: r.url(), headers: r.headers() });
  });
  try {
    await signIn(page);
    await page.goto(`${base}/direct`, { waitUntil: "networkidle" });
    await page.getByTestId("live-start").click();
    await waitView(page, ["listen", "cands", "named", "between"], 30_000);
    await sleep(Math.min(25_000, meta.total_s * 500));
    await stopAndEnd(page);
    const before = await page.evaluate(() => window.__aqr.ws.length);
    check(
      "rien n'a été envoyé au serveur avant le geste « Garder »",
      calls.length === 0,
      `${calls.length} envoi(s)`,
    );
    // 1. « Ne rien garder » puis « Annuler » : le son revient.
    await page.getByTestId("live-discard").click();
    await page.getByTestId("live-keep-discarded").waitFor();
    await keepShot(page, "rien-garde");
    check(
      "« Ne rien garder » dit que rien n'a été gardé",
      /Rien n’a été gardé/.test(
        await page.getByTestId("live-keep-discarded").innerText(),
      ),
    );
    await page.getByTestId("live-undo").click();
    await page.getByTestId("live-keep").waitFor();
    check(
      "« Annuler » (6 s) restaure le son : « Garder » est de nouveau proposé",
      true,
    );
    // 2. Garder : envoi réel, comme un import classique.
    await page.getByTestId("live-keep").click();
    await page.getByTestId("live-keep-queued").waitFor({ timeout: 60_000 });
    await keepShot(page, "garde");
    check("« Garder » met l'enregistrement dans la file d'analyse", true);
    const upload = calls.find((c) => c.method === "POST");
    check(
      "envoyé comme un import classique (autorun, source microphone)",
      !!upload &&
        /autorun=1/.test(upload.url) &&
        upload.headers["x-aqr-source-kind"] === "microphone",
      upload ? `${upload.url} ${upload.headers["x-aqr-source-kind"]}` : "",
    );
    check(
      "le nom proposé est « Récitation en direct, hh:mm »",
      !!upload &&
        /R%C3%A9citation%20en%20direct/.test(
          upload.headers["x-aqr-name"] ?? "",
        ),
      decodeURIComponent(upload?.headers["x-aqr-name"] ?? ""),
    );
    const mine = await page.evaluate(async () =>
      (
        await (await fetch("/api/sessions?scope=mine&limit=3")).json()
      ).items.map((s) => ({ id: s.id, name: s.name, state: s.state })),
    );
    results.sessions = mine;
    check(
      "la session apparaît dans la liste de l'atelier",
      mine.some((s) => /Récitation en direct/.test(s.name)),
      JSON.stringify(mine[0]),
    );
    check(
      "les résultats du direct n'ont pas été réutilisés (analyse complète en file)",
      mine[0] && ["queued", "running", "ready", "done"].includes(mine[0].state),
      mine[0]?.state,
    );
    void before;
    results.kept_session =
      mine.find((s) => /Récitation en direct/.test(s.name)) ?? null;
  } finally {
    await context.close();
    await browser.close();
  }
}

/** Mode technique : éteint par défaut, activé par la touche T ; PARTIAL n'apparaît que là, jamais dans la région annoncée. */
async function tech() {
  const { wav } = clip();
  const browser = await launch({ wav });
  const { context, page } = await newPage(browser);
  try {
    await signIn(page);
    await page.goto(`${base}/direct`, { waitUntil: "networkidle" });
    check(
      "mode technique éteint par défaut (aucun panneau)",
      (await page.getByTestId("live-tech").count()) === 0,
    );
    check(
      "l'interrupteur est éteint",
      (await page
        .getByTestId("live-tech-switch")
        .getAttribute("aria-checked")) === "false",
    );
    await page.keyboard.press("t");
    await page.getByTestId("live-tech").waitFor({ timeout: 3000 });
    check(
      "la touche T allume le mode technique",
      (await page
        .getByTestId("live-tech-switch")
        .getAttribute("aria-checked")) === "true",
    );
    await page.getByTestId("live-start").click();
    await waitView(page, ["listen", "cands", "named", "between"], 30_000);
    await page.waitForFunction(
      () =>
        /[؀-ۿ]/.test(
          document.querySelector('[data-testid="live-tech"] .partial .txt')
            ?.textContent ?? "",
        ),
      null,
      { timeout: 40_000 },
    );
    await sleep(2500);
    await keepShot(page, "technique");
    const techText = await page.getByTestId("live-tech").innerText();
    check(
      "la transcription provisoire est étiquetée « non vérifiée, jamais le texte du Mushaf »",
      /non vérifiée/.test(techText) &&
        /jamais le texte du Mushaf/.test(techText),
    );
    check(
      "les derniers messages du service sont listés",
      /CANDIDATES|PARTIAL|PROGRESS|LOCKED/.test(techText),
    );
    const partial = (
      await page.locator('[data-testid="live-tech"] .partial .txt').innerText()
    ).trim();
    const announced = await page.getByTestId("live-announce").innerText();
    check(
      "PARTIAL n'entre jamais dans la région annoncée",
      partial.length > 0 && !announced.includes(partial.slice(0, 6)),
      announced,
    );
    const stage = await page.getByTestId("live-stage").innerText();
    check(
      "PARTIAL n'est pas affiché comme « passage entendu » dans la carte",
      !stage.includes(partial.slice(0, 8)) || (await view(page)) === "named",
    );
    await page.keyboard.press("t");
    check(
      "T éteint le panneau",
      (await page.getByTestId("live-tech").count()) === 0,
    );
    await page.getByTestId("live-stop").click();
    await waitView(page, "end", 40_000);
  } finally {
    await context.close();
    await browser.close();
  }
}

const runners = {
  keep,
  tech,
  inject: injected,
  nominal,
  cut,
  token,
  micbusy: () => micRefused("micbusy"),
  nomic: () => micRefused("none"),
  deny: () => micRefused("deny"),
  busy,
  pause,
};
const run = runners[scenario];
if (!run) {
  console.error(
    `Scénario inconnu : ${scenario} (${Object.keys(runners).join(", ")})`,
  );
  process.exit(2);
}
let failed = 0;
try {
  await run();
} catch (error) {
  failed = 1;
  console.error(`ÉCHEC du scénario ${scenario} : ${error.stack ?? error}`);
  results.error = String(error.message ?? error);
}
failed += results.checks.filter((c) => !c.ok).length;
writeFileSync(path.join(out, `${tag}.json`), JSON.stringify(results, null, 1));
console.log(
  `\n${results.checks.length} contrôles, ${failed} en échec. Détail : ${path.join(out, `${tag}.json`)}`,
);
process.exit(failed ? 1 : 0);
