#!/usr/bin/env node
/**
 * Garde de mise en page de l'atelier : aucune page ne déborde horizontalement, de 320 à 1400 px
 * (pas de 20 px), en thème clair et sombre. Mesure, dans un vrai navigateur :
 *   - la page : document.documentElement.scrollWidth <= clientWidth ;
 *   - l'en-tête de l'application : aucun enfant ne dépasse le bord droit de la fenêtre ;
 *   - la liste /sessions : chaque cellule de chaque ligne (et de l'en-tête de colonnes) reste dans
 *     sa ligne, et la ligne reste dans sa carte.
 * Aucun succès muet : une ressource absente (serveur, Chromium) est un ÉCHEC code 2.
 *
 * Variables :
 *   AQR_SMOKE_URL       serveur déjà lancé sur un build de production (`next build` + `next start`)
 *   AQR_SMOKE_USER / AQR_SMOKE_PASSWORD  compte de test ; sans eux, un compte jetable est créé
 *                       par l'écran d'inscription (AQR_SIGNUP=open sur l'instance de test)
 *   AQR_SMOKE_CHROMIUM  exécutable Chromium (défaut : celui de playwright-core)
 *   AQR_LAYOUT_STEP     pas en px (défaut 20) · AQR_LAYOUT_MIN / AQR_LAYOUT_MAX (320 / 1400)
 *   AQR_LAYOUT_JSON     écrit le détail des mesures dans ce fichier
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.env.AQR_SMOKE_URL;
if (!base) {
  console.error("ÉCHEC : AQR_SMOKE_URL absent (serveur de production requis).");
  process.exit(2);
}
const step = Number(process.env.AQR_LAYOUT_STEP || 20);
const minW = Number(process.env.AQR_LAYOUT_MIN || 320);
const maxW = Number(process.env.AQR_LAYOUT_MAX || 1400);
const HEIGHT = 900;
const THEMES = ["light", "dark"];

/** Mesure exécutée dans la page : renvoie la liste des dépassements constatés. */
function measure() {
  const out = [];
  const root = document.documentElement;
  const vw = root.clientWidth;
  if (root.scrollWidth > vw)
    out.push(`page: scrollWidth ${root.scrollWidth} > clientWidth ${vw}`);
  const header = document.querySelector(".header");
  if (header) {
    if (header.scrollWidth > header.clientWidth)
      out.push(
        `en-tête: scrollWidth ${header.scrollWidth} > clientWidth ${header.clientWidth}`,
      );
    for (const el of header.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width && r.right > vw + 0.5)
        out.push(
          `en-tête: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)} dépasse (${Math.round(r.right)} > ${vw})`,
        );
    }
  }
  for (const row of document.querySelectorAll(".srow, .shead")) {
    const rr = row.getBoundingClientRect();
    const card = row.parentElement?.getBoundingClientRect();
    const label = row.className.split(" ")[0];
    if (card && rr.right > card.right + 0.5)
      out.push(
        `liste: ${label} déborde de sa carte (${Math.round(rr.right)} > ${Math.round(card.right)})`,
      );
    if (row.scrollWidth > row.clientWidth + 0.5)
      out.push(
        `liste: ${label} scrollWidth ${row.scrollWidth} > clientWidth ${row.clientWidth}`,
      );
    for (const cell of row.children) {
      const r = cell.getBoundingClientRect();
      if (!r.width) continue;
      if (r.right > rr.right + 0.5 || r.left < rr.left - 0.5)
        out.push(
          `liste: cellule ${cell.className.split(" ")[0] || cell.tagName.toLowerCase()} hors de sa ligne (${Math.round(r.left)}..${Math.round(r.right)} pour ${Math.round(rr.left)}..${Math.round(rr.right)})`,
        );
    }
    // Un bouton d'action coupé par un overflow:hidden d'un ancêtre : visible = dans la carte.
    for (const btn of row.querySelectorAll(".fav, .more, [data-testid]")) {
      const r = btn.getBoundingClientRect();
      if (r.width && card && r.right > card.right + 0.5)
        out.push(
          `liste: ${btn.getAttribute("data-testid") || btn.className} coupé (${Math.round(r.right)} > ${Math.round(card.right)})`,
        );
    }
  }
  // Le contenu d'une carte reste dans la carte (hors zones défilantes voulues et éléments positionnés).
  for (const card of document.querySelectorAll(".card, .tile")) {
    const cr = card.getBoundingClientRect();
    if (!cr.width) continue;
    for (const el of card.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (!r.width || r.right <= cr.right + 0.5) continue;
      let clipped = false;
      for (let a = el; a && a !== card; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (cs.position === "absolute" || cs.position === "fixed")
          clipped = true;
        if (cs.overflowX !== "visible") clipped = clipped || a !== el;
      }
      if (!clipped) {
        out.push(
          `carte: ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 24)} sort de sa carte (${Math.round(r.right)} > ${Math.round(cr.right)})`,
        );
        break;
      }
    }
  }
  return [...new Set(out)];
}

const browser = await chromium.launch({
  executablePath: process.env.AQR_SMOKE_CHROMIUM || undefined,
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: HEIGHT },
});
const page = await context.newPage();
const results = [];
let failures = 0;
try {
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
      .fill(`layout-${Date.now().toString(36)}`);
    await page
      .getByLabel("Mot de passe", { exact: true })
      .fill(`${randomBytes(12).toString("base64url")}-aA1`);
    await page.getByTestId("register-submit").click();
  }
  await page.getByTestId("new-trial").waitFor({ timeout: 30_000 });

  // Une session réelle à ouvrir pour la page de revue.
  await page.goto(`${base}/sessions`, { waitUntil: "domcontentloaded" });
  const link = page.getByTestId("open-session").first();
  await link.waitFor({ timeout: 30_000 });
  const reviewPath = await link.getAttribute("href");
  const pages = [
    ["/sessions", "/sessions"],
    ["revue", reviewPath],
    ["/docs", "/docs"],
    ["/performance", "/performance"],
    ["/direct", "/direct"],
    ["nouvel essai", "/?vue=new"],
    ["/compte", "/compte"],
  ];

  for (const theme of THEMES) {
    for (const [name, path] of pages) {
      await page.setViewportSize({ width: 1280, height: HEIGHT });
      await page.goto(`${base}${path}`, { waitUntil: "domcontentloaded" });
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
      }, theme);
      await page.waitForLoadState("networkidle").catch(() => {});
      if (name === "/sessions")
        await page.getByTestId("session-item").first().waitFor();
      for (let w = minW; w <= maxW; w += step) {
        await page.setViewportSize({ width: w, height: HEIGHT });
        await page.waitForTimeout(60);
        const problems = await page.evaluate(measure);
        results.push({ theme, page: name, width: w, problems });
        if (problems.length) {
          failures += 1;
          console.log(
            `✗ ${theme} ${name} ${w}px — ${problems.slice(0, 3).join(" | ")}`,
          );
        }
      }
    }
  }
} finally {
  await browser.close();
}
if (process.env.AQR_LAYOUT_JSON)
  writeFileSync(process.env.AQR_LAYOUT_JSON, JSON.stringify(results, null, 1));
const bad = results.filter((r) => r.problems.length);
const widths = (name) =>
  [
    ...new Set(
      bad.filter((r) => r.page === name || name === "*").map((r) => r.width),
    ),
  ].sort((a, b) => a - b);
console.log(
  `${results.length} mesures, ${failures} en échec. Largeurs fautives : ${widths("*").join(", ") || "aucune"}`,
);
process.exit(failures ? 1 : 0);
