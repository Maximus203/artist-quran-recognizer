import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LogFiles, verifyChain } from "./log-files";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-logs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const at = (iso: string) => () => new Date(iso);
const lines = async (file: string) =>
  (await readFile(path.join(dir, file), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

describe("journal en fichiers", () => {
  it("un fichier par flux et par jour, une ligne JSON par événement, horodatage UTC", async () => {
    const logs = new LogFiles({ dir, now: at("2026-10-30T10:00:00.000Z") });
    logs.write("app", { level: "info", scope: "init", msg: "démarré" });
    logs.write("access", {
      level: "info",
      scope: "access",
      msg: "GET /api/x 200",
      rid: "r1",
      ms: 12,
    });
    logs.write("queue", {
      level: "info",
      scope: "jobs",
      msg: "analyse terminée",
    });
    logs.write("security", {
      level: "info",
      scope: "audit",
      msg: "login.success",
    });
    const files = (await readdir(dir)).sort();
    expect(files).toEqual([
      "access-2026-10-30.log",
      "app-2026-10-30.log",
      "queue-2026-10-30.log",
      "security-2026-10-30.log",
    ]);
    const [entry] = await lines("access-2026-10-30.log");
    expect(entry).toMatchObject({
      ts: "2026-10-30T10:00:00.000Z",
      level: "info",
      scope: "access",
      rid: "r1",
      ms: 12,
    });
  });

  it("change de fichier à minuit (UTC)", async () => {
    let now = new Date("2026-10-30T23:59:59.000Z");
    const logs = new LogFiles({ dir, now: () => now });
    logs.write("app", { level: "info", scope: "s", msg: "avant" });
    now = new Date("2026-10-31T00:00:01.000Z");
    logs.write("app", { level: "info", scope: "s", msg: "après" });
    expect((await readdir(dir)).sort()).toEqual([
      "app-2026-10-30.log",
      "app-2026-10-31.log",
    ]);
  });

  it("tourne au-delà de la taille maximale (suffixe numérique)", async () => {
    const logs = new LogFiles({
      dir,
      maxBytes: 300,
      now: at("2026-10-30T10:00:00.000Z"),
    });
    for (let i = 0; i < 12; i++)
      logs.write("app", {
        level: "info",
        scope: "s",
        msg: `ligne numéro ${i} ${"x".repeat(40)}`,
      });
    const files = (await readdir(dir)).sort();
    expect(files.length).toBeGreaterThan(2);
    expect(files[0]).toBe("app-2026-10-30.1.log");
    for (const file of files)
      expect((await stat(path.join(dir, file))).size).toBeLessThan(600);
  });

  it("droits de lecture restreints (0640) à la création, hors Windows", async () => {
    const logs = new LogFiles({ dir, now: at("2026-10-30T10:00:00.000Z") });
    logs.write("security", { level: "info", scope: "audit", msg: "x" });
    if (process.platform !== "win32") {
      const mode =
        (await stat(path.join(dir, "security-2026-10-30.log"))).mode & 0o777;
      expect(mode).toBe(0o640);
    }
  });

  it("n'échoue jamais : un dossier impossible n'arrête pas l'appelant", () => {
    const logs = new LogFiles({
      dir: path.join(dir, "fichier-pas-un-dossier", "\0interdit"),
    });
    expect(() =>
      logs.write("app", { level: "error", scope: "s", msg: "x" }),
    ).not.toThrow();
  });

  it("purge selon la rétention de chaque flux", async () => {
    const logs = new LogFiles({
      dir,
      now: at("2026-10-30T10:00:00.000Z"),
      retentionDays: { app: 30, access: 30, queue: 90, security: 365 },
    });
    const old = (name: string, daysAgo: number) =>
      writeFile(path.join(dir, name), "{}\n").then(() => {
        const when = new Date(
          Date.parse("2026-10-30T10:00:00.000Z") - daysAgo * 86_400_000,
        );
        return utimes(path.join(dir, name), when, when);
      });
    await old("app-2026-09-01.log", 60);
    await old("queue-2026-09-01.log", 60);
    await old("security-2026-09-01.log", 60);
    await old("security-2025-01-01.log", 400);
    await old("app-2026-10-29.log", 1);
    const removed = logs.prune();
    expect(removed).toBe(2);
    expect((await readdir(dir)).sort()).toEqual([
      "app-2026-10-29.log",
      "queue-2026-09-01.log",
      "security-2026-09-01.log",
    ]);
  });
});

describe("journal d'audit en chaîne (ajout seul, falsification détectable)", () => {
  it("chaque ligne porte l'empreinte de la précédente ; la chaîne se vérifie", async () => {
    const logs = new LogFiles({ dir, now: at("2026-10-30T10:00:00.000Z") });
    for (const msg of ["a", "b", "c"])
      logs.write("security", { level: "info", scope: "audit", msg });
    const text = await readFile(
      path.join(dir, "security-2026-10-30.log"),
      "utf8",
    );
    expect(verifyChain(text)).toEqual({ ok: true, lines: 3 });
    const parsed = text
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(parsed[0].prev).toMatch(/^0{16}$/);
    expect(parsed[1].prev).toBe(parsed[0].hash);
  });

  it("modifier, supprimer ou insérer une ligne casse la chaîne, et dit où", async () => {
    const logs = new LogFiles({ dir, now: at("2026-10-30T10:00:00.000Z") });
    for (const msg of ["a", "b", "c", "d"])
      logs.write("security", { level: "info", scope: "audit", msg });
    const rows = (
      await readFile(path.join(dir, "security-2026-10-30.log"), "utf8")
    )
      .trim()
      .split("\n");
    const altered = [...rows];
    altered[1] = altered[1].replace('"msg":"b"', '"msg":"B"');
    expect(verifyChain(altered.join("\n") + "\n")).toEqual({
      ok: false,
      badLine: 2,
    });
    const removed = [rows[0], rows[2], rows[3]];
    expect(verifyChain(removed.join("\n") + "\n")).toMatchObject({
      ok: false,
      badLine: 2,
    });
  });

  it("la chaîne continue après un redémarrage (même fichier, nouvelle instance)", async () => {
    const first = new LogFiles({ dir, now: at("2026-10-30T10:00:00.000Z") });
    first.write("security", { level: "info", scope: "audit", msg: "avant" });
    const second = new LogFiles({ dir, now: at("2026-10-30T11:00:00.000Z") });
    second.write("security", { level: "info", scope: "audit", msg: "après" });
    const text = await readFile(
      path.join(dir, "security-2026-10-30.log"),
      "utf8",
    );
    expect(verifyChain(text)).toEqual({ ok: true, lines: 2 });
  });
});
