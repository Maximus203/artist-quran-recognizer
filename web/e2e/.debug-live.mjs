import { chromium } from "playwright-core";
import { randomBytes } from "node:crypto";
const base = "http://127.0.0.1:3410";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--use-file-for-fake-audio-capture=D:/01-Dev/Data/tmp-ibrahima-live/clips/fatiha-alafasy.wav%noloop",
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["microphone"] });
const page = await ctx.newPage();
page.on("console", (m) => console.log("console", m.type(), m.text()));
page.on("pageerror", (e) => console.log("pageerror", e.message));
page.on("requestfailed", (r) => console.log("requestfailed", r.url(), r.failure()?.errorText));
page.on("response", (r) => { if (r.url().includes("/api/live")) console.log("resp", r.status(), r.url()); });
await page.goto(`${base}/register`);
await page.getByLabel("Pseudonyme").fill(`dbg-${randomBytes(3).toString("hex")}`);
await page.getByLabel("Mot de passe", { exact: true }).fill(`${randomBytes(12).toString("base64url")}-aA1`);
await page.getByTestId("register-submit").click();
await page.getByTestId("new-trial").waitFor();
await page.goto(`${base}/direct`, { waitUntil: "networkidle" });
await page.getByTestId("live-start").click();
for (let i = 0; i < 8; i++) {
  await new Promise((r) => setTimeout(r, 1500));
  const v = await page.evaluate(() => document.querySelector('[data-testid="live-stage"]')?.dataset.view + " | " + document.querySelector('[data-testid="live-dock"]')?.innerText.replace(/\n/g, " "));
  console.log(i, v);
}
await page.screenshot({ path: "D:/01-Dev/Data/tmp-ibrahima-live/proof/debug.png" });
await browser.close();
