#!/usr/bin/env node
/**
 * Banc d'essai de fluidité de l'atelier (build de production, jamais `next dev`).
 *
 * Il ouvre une session d'un serveur déjà lancé, rejoue les gestes réels d'un testeur et mesure, dans
 * le navigateur : images (deltas de requestAnimationFrame), tâches longues, latence geste -> image
 * peinte, commits React, nœuds DOM, écouteurs, mémoire JS, temps de style/mise en page (CDP).
 *
 *   node e2e/perf-measure.mjs --url http://127.0.0.1:3871 --session <uuid> [--label avant]
 *        [--user nom --password mdp] [--only open,jumps] [--cpu 4] [--mobile] [--headed] [--inject-css "…"] [--profile jumps] [--trace jumps,play]
 *        [--out resultats.json]
 *
 * Précautions : pointer le serveur sur une COPIE des sessions (AQR_REVIEW_DIR / AQR_DB_PATH
 * dédiés), jamais sur les données du mainteneur. Sans --user, un compte jetable est créé par
 * l'inscription (le premier inscrit d'une base vide est administrateur).
 * Navigateur : AQR_PERF_BROWSER (chemin de chrome.exe / msedge.exe / chromium) ; sinon Chrome puis
 * Edge aux emplacements usuels de Windows.
 *
 * Scénarios : open (ouverture, squelette, crêtes), jumps (50 sauts par clic dans la liste), burst
 * (50 sauts à chaque image), keys (50 flèches du clavier), play (lecture 10 s), live (lecture avec
 * surlignage des mots), pan (glisser de la timeline), span (changement de fenêtre visible), leak
 * (mémoire après 3 x 50 sauts).
 */
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith("--")) continue;
  const next = process.argv[i + 1];
  if (next === undefined || next.startsWith("--")) args.set(a.slice(2), "1");
  else {
    args.set(a.slice(2), next);
    i++;
  }
}
const URL_BASE = (args.get("url") || "http://127.0.0.1:3871").replace(
  /\/$/,
  "",
);
const SESSION = args.get("session");
const LABEL = args.get("label") || "mesure";
const ALL = [
  "open",
  "jumps",
  "burst",
  "keys",
  "play",
  "live",
  "pan",
  "span",
  "leak",
];
const ONLY = args.get("only") ? args.get("only").split(",") : ALL;
const CPU = Number(args.get("cpu") || 1);
const MOBILE = args.has("mobile");
const PROFILE = args.get("profile") ? args.get("profile").split(",") : [];
const TRACE = args.get("trace") ? args.get("trace").split(",") : [];
const OUT = args.get("out");
if (!SESSION) {
  console.error("--session <uuid> est obligatoire");
  process.exit(2);
}

function browserPath() {
  const candidates = [
    process.env.AQR_PERF_BROWSER,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error("Aucun navigateur trouvé (AQR_PERF_BROWSER).");
  return found;
}

/** Instruments injectés avant tout script de la page. */
const INSTRUMENTS = `(() => {
  const P = (window.__perf = {
    on: false, commits: 0, frames: [], tasks: [], loaf: [], lat: { click: [], keydown: [], pointerdown: [] },
    last: 0, raf: 0, marks: {}, json: [], words: 0,
  });
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(),
    inject() { return 1; }, checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onCommitFiberRoot() { if (P.on) P.commits++; },
  };
  try { new PerformanceObserver((l) => { if (P.on) for (const e of l.getEntries()) P.tasks.push(e.duration); }).observe({ type: "longtask" }); } catch {}
  try {
    new PerformanceObserver((l) => {
      if (!P.on) return;
      for (const e of l.getEntries())
        P.loaf.push({ d: e.duration, b: e.blockingDuration, render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0, sl: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0 });
    }).observe({ type: "long-animation-frame" });
  } catch {}
  const parse = Response.prototype.json;
  Response.prototype.json = async function () {
    const t = performance.now();
    const v = await parse.call(this);
    if (this.url.includes("/peaks")) P.json.push(performance.now() - t);
    return v;
  };
  const afterPaint = () => new Promise((r) => requestAnimationFrame(() => { const c = new MessageChannel(); c.port1.onmessage = () => r(performance.now()); c.port2.postMessage(0); }));
  P.afterPaint = afterPaint;
  for (const type of ["click", "keydown", "pointerdown"])
    document.addEventListener(type, (e) => { if (!P.on) return; const t0 = e.timeStamp; afterPaint().then((t1) => P.lat[type].push(t1 - t0)); }, true);
  const loop = (t) => { if (!P.on) return; P.frames.push(t - P.last); P.last = t; P.raf = requestAnimationFrame(loop); };
  P.begin = () => { Object.assign(P, { on: true, commits: 0, frames: [], tasks: [], loaf: [], lat: { click: [], keydown: [], pointerdown: [] } }); P.last = performance.now(); P.raf = requestAnimationFrame(loop); };
  const q = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  const r1 = (v) => (v === null ? null : Math.round(v * 10) / 10);
  P.end = () => {
    P.on = false; cancelAnimationFrame(P.raf);
    const f = P.frames.slice(1);
    const lat = [...P.lat.click, ...P.lat.keydown, ...P.lat.pointerdown];
    return {
      frames: f.length, frameP50: r1(q(f, 0.5)), frameP95: r1(q(f, 0.95)), frameMax: r1(Math.max(0, ...f)),
      framesOver33: f.filter((d) => d > 33.4).length,
      longTasks: P.tasks.length, longTaskMax: r1(Math.max(0, ...P.tasks)), longTaskSum: r1(P.tasks.reduce((a, b) => a + b, 0)),
      loaf: P.loaf.length, loafMax: r1(Math.max(0, ...P.loaf.map((l) => l.d))), loafBlocking: r1(P.loaf.reduce((a, l) => a + l.b, 0)),
      commits: P.commits,
      latN: lat.length, latP50: r1(q(lat, 0.5)), latP95: r1(q(lat, 0.95)), latMax: r1(Math.max(0, ...lat)),
    };
  };
  // Instants d'ouverture : le premier rendu où chaque condition est vraie.
  const conds = {
    skeleton: () => document.querySelector("[data-testid=review-view]"),
    transport: () => document.querySelector("[data-testid=transport]"),
    rows: () => document.querySelector("[data-testid=interval-row]"),
    wave: () => document.querySelector("[data-testid=listening-badge][data-state=ready]"),
  };
  const poll = () => {
    for (const [k, f] of Object.entries(conds)) if (!(k in P.marks) && f()) P.marks[k] = performance.now();
    if (Object.keys(P.marks).length < Object.keys(conds).length && performance.now() < 60000) requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = {
  label: LABEL,
  session: SESSION,
  cpu: CPU,
  mobile: MOBILE,
  when: new Date().toISOString(),
};

const browser = await chromium.launch({
  executablePath: browserPath(),
  headless: !args.has("headed"),
  args: [
    "--autoplay-policy=no-user-gesture-required",
    "--mute-audio",
    "--js-flags=--expose-gc",
    "--enable-precise-memory-info",
    "--disable-features=CalculateNativeWinOcclusion",
  ],
});
const context = await browser.newContext({
  viewport: MOBILE ? { width: 375, height: 812 } : { width: 1440, height: 900 },
  deviceScaleFactor: MOBILE ? 3 : 1,
  isMobile: MOBILE,
  hasTouch: MOBILE,
  acceptDownloads: false,
});
await context.addInitScript(INSTRUMENTS);
// Expérience : retire des zones (CSS) pour attribuer le coût (ex. --inject-css ".tl-lane{display:none}").
if (args.get("inject-css"))
  await context.addInitScript(
    `document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ${JSON.stringify(args.get("inject-css"))}; document.head.append(s); });`,
  );
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Performance.enable");
if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });

// ── connexion : compte donné, sinon inscription d'un compte jetable ──
await page.goto(`${URL_BASE}/`, { waitUntil: "domcontentloaded" });
const user = args.get("user") || `perf-${randomBytes(3).toString("hex")}`;
const password = args.get("password") || randomBytes(12).toString("base64url");
const login = await page.evaluate(
  async ([u, p, existing]) => {
    const body = JSON.stringify({ username: u, password: p });
    const headers = { "Content-Type": "application/json" };
    if (!existing) {
      const r = await fetch("/api/auth/register", {
        method: "POST",
        headers,
        body,
      });
      if (r.ok) return "registered";
    }
    const r = await fetch("/api/auth/login", { method: "POST", headers, body });
    return r.ok ? "logged" : `échec ${r.status}`;
  },
  [user, password, args.has("user")],
);
if (!/registered|logged/.test(login)) {
  console.error(`Connexion impossible : ${login}`);
  await browser.close();
  process.exit(2);
}

// ── la session : intervalles, pour choisir les cibles ──
const detail = await page.evaluate(
  async (id) => (await fetch(`/api/sessions/${id}`)).json(),
  SESSION,
);
const intervals = detail.result?.intervals ?? [];
results.intervals = intervals.length;
results.verses = intervals.filter((i) => i.kind === "verse").length;
const withWords = intervals.findIndex(
  (i, n) =>
    n > 10 &&
    i.kind === "verse" &&
    i.status === "recognized" &&
    Array.isArray(i.word_times) &&
    i.word_times.length > 3 &&
    i.t,
);
const spread = Array.from({ length: 50 }, (_, k) =>
  Math.min(
    intervals.length - 1,
    Math.round(((k + 0.5) * intervals.length) / 50),
  ),
);

const metrics = async () => {
  const { metrics: m } = await cdp.send("Performance.getMetrics");
  return Object.fromEntries(m.map((x) => [x.name, x.value]));
};
const diff = (a, b) => ({
  scriptMs: Math.round((b.ScriptDuration - a.ScriptDuration) * 1000),
  layoutMs: Math.round((b.LayoutDuration - a.LayoutDuration) * 1000),
  styleMs: Math.round((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
  layouts: Math.round(b.LayoutCount - a.LayoutCount),
  styles: Math.round(b.RecalcStyleCount - a.RecalcStyleCount),
});
const snapshot = async () => {
  const m = await metrics();
  const dom = await page.evaluate(() => document.querySelectorAll("*").length);
  return {
    domNodes: dom,
    listeners: Math.round(m.JSEventListeners),
    heapMB: Math.round((m.JSHeapUsedSize / 1048576) * 10) / 10,
  };
};
async function profiled(name, fn) {
  if (!PROFILE.includes(name)) return fn();
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const out = await fn();
  const { profile } = await cdp.send("Profiler.stop");
  const self = new Map();
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const n = byId.get(id);
    const key = `${n.callFrame.functionName || "(anonyme)"} ${n.callFrame.url.split("/").slice(-2).join("/")}:${n.callFrame.lineNumber}`;
    self.set(key, (self.get(key) || 0) + (profile.timeDeltas[i] || 0) / 1000);
  });
  out.topSelf = [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([k, v]) => `${Math.round(v)} ms  ${k}`);
  return out;
}
/** Trace Chromium du scénario : temps inclusif par type d'événement sur le fil principal. */
async function traced(name, fn) {
  if (!TRACE.includes(name)) return profiled(name, fn);
  const events = [];
  cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline",
    transferMode: "ReportEvents",
  });
  const out = (await profiled(name, fn)) || {};
  await cdp.send("Tracing.end");
  await done;
  const main = events.find(
    (e) => e.name === "thread_name" && e.args?.name === "CrRendererMain",
  );
  const totals = new Map();
  for (const e of events)
    if (e.ph === "X" && main && e.pid === main.pid && e.tid === main.tid)
      totals.set(e.name, (totals.get(e.name) || 0) + e.dur / 1000);
  const wanted = [
    "RunTask",
    "UpdateLayoutTree",
    "Layout",
    "PrePaint",
    "Paint",
    "Layerize",
    "Commit",
    "HitTest",
    "FunctionCall",
    "FireAnimationFrame",
    "EventDispatch",
    "MajorGC",
    "MinorGC",
    "RunMicrotasks",
  ];
  // Les plus longues mises en page : objets sales / total (une mise en page « tout » trahit un conteneur
  // sans confinement), pour savoir QUOI invalide, pas seulement combien de temps cela prend.
  out.layouts = events
    .filter(
      (e) =>
        e.ph === "X" &&
        e.name === "Layout" &&
        e.pid === main?.pid &&
        e.tid === main?.tid,
    )
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 5)
    .map((e) => ({
      ms: Math.round(e.dur / 100) / 10,
      dirty: e.args?.beginData?.dirtyObjects,
      total: e.args?.beginData?.totalObjects,
      partial: e.args?.beginData?.partialLayout,
      args: JSON.stringify(e.args).slice(0, 600),
    }));
  // Les tâches les plus longues et ce qu'elles contiennent : c'est ce qui fait une image perdue.
  const onMain = events.filter(
    (e) => e.ph === "X" && e.pid === main?.pid && e.tid === main?.tid,
  );
  out.bigTasks = onMain
    .filter((e) => e.name === "RunTask" && e.dur > 12000)
    .sort((a, b) => b.dur - a.dur)
    .slice(0, 6)
    .map((task) => {
      const inside = new Map();
      for (const e of onMain)
        if (e !== task && e.ts >= task.ts && e.ts + e.dur <= task.ts + task.dur)
          inside.set(e.name, (inside.get(e.name) || 0) + e.dur / 1000);
      return {
        ms: Math.round(task.dur / 100) / 10,
        inside: [...inside.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([k, v]) => `${k} ${Math.round(v)}`),
      };
    });
  out.trace = Object.fromEntries(
    wanted
      .filter((k) => totals.has(k))
      .map((k) => [k, Math.round(totals.get(k))]),
  );
  return out;
}
/** Démarrages de lecture (clic jusqu'à 1,2 s), à part du régime établi mesuré ensuite. */
const startup = [];
async function scenario(name, fn) {
  await sleep(400);
  await page.evaluate(() => window.gc?.());
  const before = await snapshot();
  const m0 = await metrics();
  await page.evaluate(() => window.__perf.begin());
  const extra = await traced(name, fn);
  const r = await page.evaluate(() => window.__perf.end());
  const m1 = await metrics();
  const after = await snapshot();
  results[name] = {
    ...r,
    cdp: diff(m0, m1),
    domBefore: before.domNodes,
    domAfter: after.domNodes,
    ...(extra || {}),
  };
  console.log(
    `✓ ${name}`,
    JSON.stringify({ ...results[name], topSelf: undefined }),
  );
}

/** (Re)ouvre la session ; retourne les instants d'ouverture mesurés dans la page. */
async function openSession() {
  await page.goto("about:blank");
  const t0 = Date.now();
  await page.goto(`${URL_BASE}/?session=${SESSION}`, { waitUntil: "commit" });
  await page.waitForSelector(
    "[data-testid=listening-badge][data-state=ready]",
    { timeout: 120000 },
  );
  await page.waitForSelector("[data-testid=interval-row]", { timeout: 60000 });
  return Date.now() - t0;
}

/** Fait apparaître la ligne `index` de la liste (virtualisée ou non) et la clique par le DOM. */
const JUMP_FN = `async (index, pause) => {
  const list = document.querySelector(".intervals-list");
  const rowH = list.scrollHeight / Math.max(1, ${intervals.length});
  let row = null;
  for (let k = 0; k < 12 && !row; k++) {
    row = list.querySelector('[data-testid=interval-row][data-index="' + index + '"]');
    if (!row) { list.scrollTop = Math.max(0, index * rowH - list.clientHeight / 2); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
  }
  if (!row) return false;
  if (pause) await new Promise((r) => setTimeout(r, pause));
  const t0 = performance.now();
  row.click();
  window.__perf.sync = (window.__perf.sync || []).concat(performance.now() - t0);
  await window.__perf.afterPaint();
  return true;
}`;

try {
  if (ONLY.includes("open")) {
    // Ouverture à froid : 3 essais, médiane ; la dernière reste ouverte pour la suite.
    const runs = [];
    for (let k = 0; k < 3; k++) {
      await page.goto("about:blank");
      await sleep(300);
      await page.evaluate(() => 0).catch(() => 0);
      await page.goto(`${URL_BASE}/?session=${SESSION}`, {
        waitUntil: "commit",
      });
      await page.evaluate(() => 0).catch(() => 0);
      await page.waitForFunction(
        () => window.__perf && Object.keys(window.__perf.marks).length >= 4,
        null,
        { timeout: 120000, polling: 100 },
      );
      const info = await page.evaluate(async () => {
        const nav = performance.getEntriesByType("navigation")[0];
        const peaks = performance
          .getEntriesByType("resource")
          .find((e) => e.name.includes("/peaks"));
        await new Promise((r) => setTimeout(r, 800));
        return {
          marks: window.__perf.marks,
          domReady: Math.round(nav.domContentLoadedEventEnd),
          peaksBytes: peaks?.encodedBodySize,
          peaksMs: Math.round(peaks?.duration ?? 0),
          peaksParseMs: window.__perf.json.map((v) => Math.round(v * 10) / 10),
          nodes: document.querySelectorAll("*").length,
          heapMB: Math.round(performance.memory.usedJSHeapSize / 104857.6) / 10,
          longtasks: performance
            .getEntriesByType("longtask")
            .map((e) => Math.round(e.duration)),
        };
      });
      runs.push(info);
    }
    runs.sort((a, b) => a.marks.wave - b.marks.wave);
    results.open = {
      median: runs[1],
      runs: runs.map((r) => ({ ...r.marks, nodes: r.nodes })),
    };
    console.log("✓ open", JSON.stringify(results.open.median));
  } else await openSession();

  if (ONLY.includes("jumps")) {
    await scenario("jumps", async () => {
      for (const index of spread)
        await page.evaluate(`(${JUMP_FN})(${index}, 120)`);
      const sync = await page.evaluate(() => window.__perf.sync.splice(0));
      return {
        clickSyncMaxMs: Math.round(Math.max(...sync) * 10) / 10,
        clickSyncP50Ms: Math.round(sync.sort((a, b) => a - b)[25] * 10) / 10,
      };
    });
  }
  if (ONLY.includes("burst")) {
    await scenario("burst", async () => {
      for (const index of spread)
        await page.evaluate(`(${JUMP_FN})(${index}, 0)`);
      await page.evaluate(() => window.__perf.sync.splice(0));
    });
  }
  if (ONLY.includes("keys")) {
    await page.focus("[data-testid=seek-forward]");
    await scenario("keys", async () => {
      for (let k = 0; k < 50; k++) {
        await page.keyboard.press(k % 2 ? "ArrowLeft" : "ArrowRight");
        await sleep(60);
      }
    });
  }
  const play = async (seconds, seekIndex) => {
    // Le démarrage (clic, premier tampon audio) est mesuré à part (`start`) ; le régime, ensuite.
    const t0 = Date.now();
    await page.evaluate(`(${JUMP_FN})(${seekIndex}, 0)`);
    await page.click("[data-testid=play]");
    await sleep(1200);
    const startMs = Date.now() - t0;
    startup.push({
      scenario: "play",
      startMs,
      ...(await page.evaluate(() => window.__perf.end())),
    });
    await page.evaluate(() => window.__perf.begin());
    await sleep(seconds * 1000);
    const state = await page.evaluate(() => ({
      t: document.querySelector("[data-testid=time-now]")?.textContent,
      playing: document
        .querySelector("[data-testid=play]")
        ?.getAttribute("aria-label"),
    }));
    await page.click("[data-testid=play]");
    return state;
  };
  if (ONLY.includes("play")) {
    // Lecture dans une zone sans mots suivis (début du fichier) : isole l'avance de la tête de lecture.
    await scenario("play", () => play(10, 5));
  }
  if (ONLY.includes("live") && withWords >= 0) {
    const live = await page.$("[data-testid=live-switch]");
    if (live && (await live.getAttribute("aria-checked")) !== "true")
      await live.click();
    await scenario("live", async () => ({
      at: withWords,
      ...(await play(10, withWords)),
    }));
  }
  if (ONLY.includes("pan")) {
    await page.selectOption("[data-testid=span-select]", "120");
    await sleep(500);
    const box = await page
      .locator("[data-testid=timeline-scroll]")
      .boundingBox();
    await scenario("pan", async () => {
      const y = box.y + 30;
      for (const [from, to] of [
        [0.8, 0.2],
        [0.2, 0.9],
        [0.9, 0.1],
      ]) {
        await page.mouse.move(box.x + box.width * from, y);
        await page.mouse.down();
        const steps = 90;
        for (let s = 1; s <= steps; s++) {
          await page.mouse.move(
            box.x + box.width * (from + ((to - from) * s) / steps),
            y,
          );
          await sleep(8);
        }
        await page.mouse.up();
        await sleep(100);
      }
    });
  }
  if (ONLY.includes("span")) {
    await scenario("span", async () => {
      // Latence de chaque changement de fenêtre (valeur posée -> image peinte), pas seulement le total.
      const steps = [];
      for (const value of [
        "600",
        "120",
        "30",
        "10",
        "",
        "600",
        "30",
        "",
        "120",
        "10",
        "",
      ]) {
        steps.push([
          value || "entier",
          await page.evaluate(async (v) => {
            const select = document.querySelector("[data-testid=span-select]");
            const t0 = performance.now();
            const setter = Object.getOwnPropertyDescriptor(
              HTMLSelectElement.prototype,
              "value",
            ).set;
            setter.call(select, v);
            select.dispatchEvent(new Event("change", { bubbles: true }));
            await window.__perf.afterPaint();
            return Math.round((performance.now() - t0) * 10) / 10;
          }, value),
        ]);
        await sleep(150);
      }
      return { steps };
    });
  }
  if (ONLY.includes("leak")) {
    await page.selectOption("[data-testid=span-select]", "");
    await sleep(400);
    await page.evaluate(() => window.gc?.());
    const start = await snapshot();
    const rounds = [];
    for (let k = 0; k < 3; k++) {
      for (const index of spread)
        await page.evaluate(`(${JUMP_FN})(${index}, 20)`);
      await page.evaluate(() => window.__perf.sync?.splice(0));
      await sleep(300);
      await page.evaluate(() => window.gc?.());
      rounds.push(await snapshot());
    }
    results.leak = { start, rounds };
    console.log("✓ leak", JSON.stringify(results.leak));
  }
} finally {
  await browser.close();
}

if (startup.length) results.startup = startup;
if (OUT) writeFileSync(OUT, JSON.stringify(results, null, 2));
else console.log(JSON.stringify(results, null, 2));
