#!/usr/bin/env node
/**
 * Garde de navigation de l'atelier : tout ce qu'on peut atteindre depuis l'en-tête sur ordinateur
 * (1440 px) l'est aussi sur téléphone et tablette (360, 375, 390, 768, 1024 px), dans un vrai navigateur.
 * Pour le compte connecté (son rôle décide des pages offertes) et pour chaque largeur :
 *   - les destinations atteignables (liens de la barre, de ses groupes, du menu du compte) ⊇ celles de 1440 ;
 *   - chaque commande de l'en-tête visible fait au moins 44 px (cible tactile) ;
 *   - aucune page ne défile horizontalement ;
 *   - un menu s'ouvre (aria-expanded), se ferme à Échap et rend le focus à son bouton.
 * Aucun succès muet : serveur ou Chromium absents = ÉCHEC code 2.
 *
 * Variables :
 *   AQR_SMOKE_URL       serveur déjà lancé sur un build de production (`next build` + `next start`)
 *   AQR_SMOKE_USER / AQR_SMOKE_PASSWORD  compte de test (rôle quelconque) ; lancer une fois par rôle
 *   AQR_SMOKE_CHROMIUM  exécutable Chromium (défaut : celui de playwright-core)
 *   AQR_NAV_JSON        écrit le détail des mesures dans ce fichier
 */
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const base = process.env.AQR_SMOKE_URL;
const user = process.env.AQR_SMOKE_USER;
const password = process.env.AQR_SMOKE_PASSWORD;
if (!base || !user || !password) {
  console.error(
    "ÉCHEC : AQR_SMOKE_URL, AQR_SMOKE_USER et AQR_SMOKE_PASSWORD sont requis.",
  );
  process.exit(2);
}
const DESKTOP = 1440;
const SMALL = [360, 375, 390, 768, 1024];
const PAGES = ["/", "/sessions", "/telechargements", "/compte"];
const HIT = 44;

/**
 * Ouvre une page en respectant la limite de débit du serveur (240 pages par minute et par compte :
 * chaque page en coûte une douzaine) : sur « Trop de requêtes », on attend et on recommence.
 */
async function open(page, url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const limited = await page
      .getByText("Trop de requêtes", { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (!limited) return;
    await page.waitForTimeout(23_000);
  }
  throw new Error(`limite de débit persistante sur ${url}`);
}

/** Exécuté dans la page : les destinations visibles de l'en-tête, menus ouverts un à un. */
async function reachable(page) {
  const grab = () =>
    page.evaluate(() => {
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return (
          r.width > 1 &&
          r.height > 1 &&
          s.visibility !== "hidden" &&
          s.display !== "none"
        );
      };
      return [
        ...document.querySelectorAll(
          "header.header a[href], .nav-pop a[href], .menu a[href]",
        ),
      ]
        .filter(shown)
        .map((a) => a.getAttribute("href"))
        .filter((h) => h && !h.startsWith("/?vue="));
    });
  const found = new Set(await grab());
  for (const trigger of [
    ...(await page.$$(".nav-group > button")),
    ...(await page.$$('[data-testid="account-button"]')),
  ]) {
    if (!(await trigger.isVisible())) continue;
    await trigger.click();
    await page.waitForTimeout(200);
    (await grab()).forEach((h) => found.add(h));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
  }
  return [...found].sort();
}

/** Exécuté dans la page : commandes de l'en-tête visibles plus petites que la cible tactile. */
const smallControls = (hit) =>
  [
    ...document.querySelectorAll(
      "header.header a, header.header button, .nav-pop a, .menu a, .menu button",
    ),
  ]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 1 &&
        r.height > 1 &&
        s.visibility !== "hidden" &&
        (r.width < hit - 0.5 || r.height < hit - 0.5)
      );
    })
    .map((el) => {
      const r = el.getBoundingClientRect();
      return `${el.tagName.toLowerCase()}[${el.getAttribute("data-testid") || el.textContent.trim().slice(0, 20)}] ${Math.round(r.width)}x${Math.round(r.height)}`;
    });

const browser = await chromium.launch({
  executablePath: process.env.AQR_SMOKE_CHROMIUM || undefined,
  headless: true,
});
const failures = [];
const detail = {};
try {
  const context = await browser.newContext({
    viewport: { width: DESKTOP, height: 900 },
  });
  const page = await context.newPage();
  await open(page, `${base}/login`);
  // Le formulaire s'hydrate côté client : le remplir avant efface les champs.
  await page.waitForLoadState("networkidle");
  // Un envoi en moins de 2 s est pris pour un robot (honeypot) : on laisse passer le délai minimal.
  await page.waitForTimeout(2200);
  await page.getByLabel("Pseudonyme").fill(user);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByTestId("login-submit").click();
  await page.getByTestId("new-trial").waitFor({ timeout: 30_000 });

  await open(page, `${base}/`);
  await page.getByTestId("account-button").waitFor();
  const desktop = await reachable(page);
  detail[DESKTOP] = desktop;
  if (desktop.length < 3)
    failures.push(`bureau : seulement ${desktop.length} destinations lues`);

  for (const w of SMALL) {
    await page.setViewportSize({ width: w, height: 800 });
    await open(page, `${base}/`);
    await page.getByTestId("account-button").waitFor();
    await page.waitForTimeout(150);
    const here = await reachable(page);
    detail[w] = here;
    const missing = desktop.filter((h) => !here.includes(h));
    if (missing.length)
      failures.push(
        `${w}px : absent du téléphone/tablette : ${missing.join(", ")}`,
      );

    for (const path of PAGES) {
      await open(page, `${base}${path}`);
      await page.getByTestId("account-button").waitFor();
      await page.waitForTimeout(150);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      if (overflow > 0)
        failures.push(
          `${w}px ${path} : défilement horizontal (+${overflow}px)`,
        );
    }

    await open(page, `${base}/`);
    await page.getByTestId("account-button").waitFor();
    const button = page.getByTestId("account-button");
    await button.click();
    if ((await button.getAttribute("aria-expanded")) !== "true")
      failures.push(`${w}px : le menu du compte ne s'ouvre pas`);
    const small = await page.evaluate(smallControls, HIT);
    if (small.length)
      failures.push(
        `${w}px : cibles < ${HIT}px : ${small.slice(0, 4).join(" ; ")}`,
      );
    await page.keyboard.press("Escape");
    if ((await button.getAttribute("aria-expanded")) !== "false")
      failures.push(`${w}px : Échap ne ferme pas le menu du compte`);
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute("data-testid"),
    );
    if (focused !== "account-button")
      failures.push(`${w}px : le focus ne revient pas au bouton du compte`);
  }
} finally {
  await browser.close();
}
if (process.env.AQR_NAV_JSON)
  writeFileSync(process.env.AQR_NAV_JSON, JSON.stringify(detail, null, 1));
for (const f of failures) console.log(`✗ ${f}`);
console.log(
  failures.length
    ? `${failures.length} écart(s) de navigation.`
    : `Navigation identique de ${SMALL[0]} à ${DESKTOP} px (${detail[DESKTOP].length} destinations).`,
);
process.exit(failures.length ? 1 : 0);
