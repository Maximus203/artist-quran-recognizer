#!/usr/bin/env node
/**
 * Garde de mesure de l'éditeur d'export sur téléphone (recette QA 2, N1 / N4 / N5) : dans un vrai Chrome tactile,
 * l'aperçu ne descend JAMAIS sous son plancher, aucune commande n'est recouverte, et la fenêtre de contenu du pas à pas
 * reste lisible. Parcours RÉEL : la session, puis son bouton « Exporter » (le lecteur réduit est présent avant d'entrer),
 * puis l'onglet Vidéo. Trois éditeurs × six écrans (360 × 640 à 430 × 932, paysage 667 × 375 et 844 × 390) × repos et
 * panneau ou feuille ouverts.
 *
 * Aucun succès muet : un serveur, un navigateur ou un corpus absent est un ÉCHEC code 2.
 *
 * Variables :
 *   AQR_SMOKE_URL       serveur déjà lancé sur un build de production (`next build` + `next start`)
 *   AQR_SMOKE_USER / AQR_SMOKE_PASSWORD   compte de test ; sans eux, un compte jetable est créé (AQR_SIGNUP=open)
 *   AQR_SMOKE_CHROMIUM  exécutable Chromium (défaut : celui de playwright-core)
 *   AQR_CORPUS_FILE     texte du corpus (défaut : ../data/corpus/quran-uthmani.txt), pour une session réaliste
 *   AQR_STAGE_ONLY      un éditeur seulement : plateau, table ou pas
 *   AQR_STAGE_JSON      écrit le détail des mesures dans ce fichier
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.AQR_SMOKE_URL;
if (!base) {
  console.error("ÉCHEC : AQR_SMOKE_URL absent (serveur de production requis).");
  process.exit(2);
}
const corpusFile =
  process.env.AQR_CORPUS_FILE ||
  path.join(process.cwd(), "..", "data", "corpus", "quran-uthmani.txt");
if (!existsSync(corpusFile)) {
  console.error(
    `ÉCHEC : corpus absent (${corpusFile}) — python scripts/fetch_corpus.py`,
  );
  process.exit(2);
}

/** Le plancher : hauteur du cadre (portrait / paysage). Voir `--xe-stage-h-min`. */
const FLOOR_H = { portrait: 160, landscape: 140 };
/** Le plancher de la fenêtre de contenu du pas à pas (`--xp-body-min`), hors paysage (dont la colonne est plus basse). */
const BODY_MIN = { portrait: 160, landscape: 120 };
const SIZES = [
  [360, 640],
  [360, 740],
  [390, 844],
  [430, 932],
  [667, 375],
  [844, 390],
];
const ONLY = process.env.AQR_STAGE_ONLY;
const MODES = ["plateau", "table", "pas"].filter((m) => !ONLY || m === ONLY);

/* ─────────────────────── une session réaliste : texte du corpus, audio de test ─────────────────────── */
function wav(seconds) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++)
    buf.writeInt16LE(
      Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 3000),
      44 + i * 2,
    );
  return buf;
}
const verses = new Map(
  readFileSync(corpusFile, "utf8")
    .split("\n")
    .map((l) => l.trim().split("|"))
    .filter((p) => p.length >= 3)
    .map(([s, a, ...t]) => [`${s}:${a}`, t.join("|")]),
);
function result(audio, seconds) {
  const refs = ["112:1", "112:2", "112:3", "112:4"];
  const step = seconds / refs.length;
  return {
    schema: "aqr.recognition/1",
    source: {
      file: "test.wav",
      sha256: createHash("sha256").update(audio).digest("hex"),
      duration_s: seconds,
    },
    engine: {
      asr: "whisper",
      segmenter: "recitation",
      matcher: "flow",
      decoder: "v2",
      constrained: false,
      corpus: "tanzil",
    },
    decoder: {},
    timing: {},
    windows: 1,
    warnings: [],
    intervals: refs.map((ref, i) => {
      const text = verses.get(ref);
      const words = text.split(" ").length;
      const t0 = +(step * i).toFixed(2);
      const t1 = +(step * (i + 1)).toFixed(2);
      return {
        kind: "verse",
        ref,
        words: [1, words],
        partial: false,
        status: "recognized",
        t: [t0, t1],
        time_interpolated: false,
        confidence: 0.95,
        candidates: [],
        repetition: false,
        text,
        translation: null,
        word_times: Array.from({ length: words }, (_, k) => [
          +(t0 + ((t1 - t0) * k) / words).toFixed(2),
          +(t0 + ((t1 - t0) * (k + 1)) / words).toFixed(2),
        ]),
      };
    }),
  };
}

/* ──────────────────────────────── mesures exécutées dans la page ──────────────────────────────── */
function measure() {
  const stage = document.querySelector("[data-testid=video-stage]");
  const r = stage?.getBoundingClientRect();
  let seen = 0;
  if (stage && r) {
    let ok = 0;
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        const x = r.x + (r.width * (i + 0.5)) / 6;
        const y = r.y + (r.height * (j + 0.5)) / 6;
        const hit =
          x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
            ? document.elementFromPoint(x, y)
            : null;
        if (hit && stage.contains(hit)) ok++;
      }
    seen = ok / 36;
  }
  const body = document
    .querySelector("[data-testid=pas-body]")
    ?.getBoundingClientRect();
  // Les commandes de l'éditeur, une à une : après défilement, jamais recouvertes, toujours dans l'écran.
  const root =
    document.querySelector(
      "[data-testid=editor-dock], [data-testid=editor-pas]",
    ) ?? document.body;
  const bad = [];
  let controls = 0;
  for (const e of root.querySelectorAll(
    "button, [role=tab], a[href], input, select",
  )) {
    if (e.closest(".xe-overlay, .xe-stage, [inert], [hidden]")) continue;
    // Le contenu d'un `<details>` fermé n'est pas là (hors du résumé) : il n'est pas une commande à atteindre.
    if (e.closest("details:not([open])") && !e.closest("summary")) continue;
    // Le champ de fichier de l'envoi du fond est caché derrière son bouton : ce n'est pas une commande à toucher.
    if (e.matches("input[type=file]")) continue;
    const cs = getComputedStyle(e);
    const b0 = e.getBoundingClientRect();
    if (
      cs.visibility === "hidden" ||
      cs.display === "none" ||
      b0.width < 1 ||
      b0.height < 1
    )
      continue;
    e.scrollIntoView({ block: "nearest", inline: "nearest" });
    const b = e.getBoundingClientRect();
    controls++;
    const hit = document.elementFromPoint(
      Math.min(innerWidth - 1, Math.max(0, b.x + b.width / 2)),
      Math.min(innerHeight - 1, Math.max(0, b.y + b.height / 2)),
    );
    const within = b.top >= -1 && b.bottom <= innerHeight + 1;
    if (!within || !(hit === e || e.contains(hit) || hit?.contains(e)))
      bad.push(
        e.getAttribute("data-testid") ||
          (e.getAttribute("aria-label") || e.textContent || "")
            .trim()
            .slice(0, 20),
      );
  }
  window.scrollTo(0, 0);
  for (const d of document.querySelectorAll(
    ".xe-dock, .xe-sheet-body, .xp-body",
  ))
    d.scrollTop = 0;
  return {
    w: r ? Math.round(r.width) : 0,
    h: r ? Math.round(r.height) : 0,
    seen,
    body: body ? Math.round(body.height) : null,
    controls,
    bad,
    hscroll:
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth,
    mini: !!document.querySelector("[data-testid=mini-player]"),
  };
}

/* ──────────────────────────────────────────── parcours ──────────────────────────────────────────── */
const browser = await chromium.launch({
  executablePath: process.env.AQR_SMOKE_CHROMIUM || undefined,
  headless: true,
});
const rows = [];
let failures = 0;
const check = (label, ok, detail) => {
  if (ok) return;
  failures += 1;
  console.log(`✗ ${label} — ${detail}`);
};
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 2,
    locale: "fr-FR",
  });
  const page = await context.newPage();
  const user = process.env.AQR_SMOKE_USER;
  const password = process.env.AQR_SMOKE_PASSWORD;
  if (user && password) {
    await page.goto(`${base}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Pseudonyme").fill(user);
    await page.getByLabel("Mot de passe", { exact: true }).fill(password);
    await page.getByTestId("login-submit").click();
  } else {
    await page.goto(`${base}/register`, { waitUntil: "domcontentloaded" });
    await page
      .getByLabel("Pseudonyme")
      .fill(`floor-${Date.now().toString(36)}`);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(`${randomBytes(12).toString("base64url")}-aA1`);
    await page.getByTestId("register-submit").click();
  }
  await page.getByTestId("new-trial").waitFor({ timeout: 30_000 });

  const audio = wav(12);
  const imported = await page.request.post(
    `${base}/api/sessions?name=${encodeURIComponent("Al-Ikhlas · plancher")}`,
    {
      multipart: {
        audio: { name: "test.wav", mimeType: "audio/wav", buffer: audio },
        result: {
          name: "r.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(result(audio, 12))),
        },
      },
    },
  );
  if (imported.status() !== 201) {
    console.error(
      `ÉCHEC : import de la session de test : ${imported.status()} ${await imported.text()}`,
    );
    process.exit(2);
  }
  const imp = await imported.json();
  const sessionId = imp.session?.id ?? imp.id;

  for (const mode of MODES) {
    await page.request.put(`${base}/api/me/preferences`, {
      data: { editorMode: mode },
    });
    for (const [w, h] of SIZES) {
      const orientation = w > h ? "landscape" : "portrait";
      await page.setViewportSize({ width: w, height: h });
      // Parcours réel : la session, « Exporter ». Une pause entre deux chargements : l'atelier limite les pages par minute.
      await page.waitForTimeout(Number(process.env.AQR_PACE_MS || 3000));
      await page.goto(`${base}/?session=${sessionId}`, {
        waitUntil: "domcontentloaded",
      });
      const entry = page.getByTestId("export-entry");
      await entry.waitFor({ timeout: 30_000 });
      // 844 × 390 : l'en-tête collant de la page de la session recouvre le bouton après le défilement automatique
      // (défaut de la page de revue, hors éditeur, signalé dans la note de version) : le clic part alors du bouton lui-même.
      await entry
        .click({ timeout: 4_000 })
        .catch(() => entry.evaluate((e) => e.click()));
      await page.getByTestId("export-page").waitFor({ timeout: 30_000 });
      await page.getByTestId("tab-video").click();
      await page.getByTestId("video-panel").waitFor({ timeout: 30_000 });
      await page.waitForTimeout(2200);
      const help = page.getByTestId("table-help-ok");
      if (await help.count()) await help.click();

      const states = [["repos", null]];
      if (mode === "plateau")
        states.push([
          "feuille",
          async () => {
            await page.getByTestId("chip-arabic").click();
            await page.getByTestId("tool-reglages").click();
          },
        ]);
      if (mode === "pas") {
        // L'étape est mémorisée entre deux chargements : on la choisit par sa pastille, jamais par « Suivant ».
        const step = (n) => async () => {
          await page.getByTestId(`pas-step-${n}`).click();
        };
        states[0] = ["étape 1", step(1)];
        states.push(["étape 2", step(2)], ["étape 3", step(3)]);
      }
      if (mode === "table")
        states.push(
          [
            "panneau",
            async () => {
              await page.getByTestId("rail-arabic").click();
            },
          ],
          [
            "cadre",
            async () => {
              await page.getByTestId("table-back").click();
              await page.getByTestId("rail-cadre").click();
            },
          ],
        );
      for (const [state, act] of states) {
        if (act) {
          await act();
          await page.waitForTimeout(700);
        }
        const m = await page.evaluate(measure);
        const label = `${mode} ${w}×${h} ${state}`;
        rows.push({ mode, w, h, state, ...m });
        console.log(
          `${m.h >= FLOOR_H[orientation] ? "✓" : "✗"} ${label}: aperçu ${m.w}×${m.h}, vu ${Math.round(m.seen * 100)} %${m.body !== null ? `, fenêtre ${m.body}` : ""}, ${m.controls - m.bad.length}/${m.controls} commandes`,
        );
        check(
          label,
          m.h >= FLOOR_H[orientation],
          `aperçu ${m.w}×${m.h} sous le plancher de ${FLOOR_H[orientation]} px de haut`,
        );
        check(
          label,
          m.seen >= 0.95,
          `aperçu vu à ${Math.round(m.seen * 100)} % seulement (recouvert)`,
        );
        check(
          label,
          m.bad.length === 0,
          `commandes recouvertes ou hors écran : ${m.bad.slice(0, 4).join(", ")}`,
        );
        check(label, !m.hscroll, "défilement horizontal de la page");
        check(
          label,
          !m.mini,
          "le lecteur réduit est encore là dans l'éditeur du téléphone",
        );
        if (m.body !== null)
          check(
            label,
            m.body >= BODY_MIN[orientation],
            `fenêtre de contenu de ${m.body} px (plancher ${BODY_MIN[orientation]})`,
          );
      }
    }
  }
  await context.close();
} finally {
  await browser.close();
}
if (process.env.AQR_STAGE_JSON)
  writeFileSync(process.env.AQR_STAGE_JSON, JSON.stringify(rows, null, 1));
console.log(`${rows.length} mesures, ${failures} en échec.`);
process.exit(failures ? 1 : 0);
