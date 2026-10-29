import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatLog, log, redact, streamOf, useLogFiles } from "./log";
import { LogFiles } from "./log-files";
import { runWithRequest } from "./request-context";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-log-"));
  useLogFiles(
    new LogFiles({ dir, now: () => new Date("2026-10-30T10:00:00.000Z") }),
  );
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  useLogFiles(null);
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const rows = async (file: string) =>
  (await readFile(path.join(dir, file), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

describe("flux", () => {
  it.each([
    ["audit", "security"],
    ["honeypot", "security"],
    ["blocklist", "security"],
    ["access", "access"],
    ["jobs", "queue"],
    ["export", "queue"],
    ["init", "app"],
    ["api", "app"],
  ])("la portée %s va dans le flux %s", (scope, stream) => {
    expect(streamOf(scope)).toBe(stream);
  });
});

describe("journal : console ET fichier", () => {
  it("écrit dans le bon fichier avec niveau, portée, message", async () => {
    log.warn("preferences", "valeur invalide ignorée");
    log.error("api", "GET /x a échoué", new Error("disque plein"));
    const entries = await rows("app-2026-10-30.log");
    expect(entries[0]).toMatchObject({
      level: "warn",
      scope: "preferences",
      msg: "valeur invalide ignorée",
    });
    expect(entries[1]).toMatchObject({
      level: "error",
      scope: "api",
      msg: "GET /x a échoué (disque plein)",
    });
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("toutes les lignes d'une requête portent le même identifiant de corrélation", async () => {
    runWithRequest("req-123", () => {
      log.info("audit", '{"event":"login.success"}');
      log.info("access", "GET /api/me 200");
      log.error("api", "boum");
    });
    log.info("init", "hors requête");
    const all = [
      ...(await rows("security-2026-10-30.log")),
      ...(await rows("access-2026-10-30.log")),
      ...(await rows("app-2026-10-30.log")),
    ];
    expect(all.filter((e) => e.rid === "req-123")).toHaveLength(3);
    expect(all.find((e) => e.msg === "hors requête").rid).toBeUndefined();
  });

  it("événements structurés : champs ajoutés, durée en millisecondes", async () => {
    log.event("jobs", "analysis.done", {
      ms: 4210,
      engine: "cascade",
      session: "abc",
    });
    const [entry] = await rows("queue-2026-10-30.log");
    expect(entry).toMatchObject({
      scope: "jobs",
      msg: "analysis.done",
      ms: 4210,
      engine: "cascade",
      session: "abc",
    });
  });

  it("ne produit qu'une ligne JSON par événement, même avec un saut de ligne dans le message", async () => {
    log.info("init", "ligne un\nligne deux");
    expect(await rows("app-2026-10-30.log")).toHaveLength(1);
  });
});

describe("jamais de secret ni de contenu", () => {
  it.each([
    [
      "jeton d'API",
      "appel avec qtr_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG refusé",
    ],
    [
      "cookie de session",
      "cookie aqr_session=Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9v; Path=/",
    ],
    [
      "en-tête Authorization",
      "Authorization: Bearer qtr_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG",
    ],
    [
      "longue clé aléatoire",
      "clé trouvée Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFy",
    ],
  ])("%s est masqué", async (_name, message) => {
    log.warn("api", message);
    const [entry] = await rows("app-2026-10-30.log");
    expect(entry.msg).toContain("<omis>");
    expect(entry.msg).not.toMatch(
      /qtr_[A-Za-z0-9_-]{20}|aqr_session=[A-Za-z0-9]{20}|Zm9vYmFy/,
    );
    const consoleLine = String(vi.mocked(console.warn).mock.calls.at(-1)?.[0]);
    expect(consoleLine).not.toMatch(/qtr_[A-Za-z0-9_-]{20}|Zm9vYmFy/);
  });

  it("le texte arabe (verset, traduction) est masqué", async () => {
    log.warn("api", "échec sur « بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ » à 0:12");
    const [entry] = await rows("app-2026-10-30.log");
    expect(entry.msg).not.toMatch(/[؀-ۿ]/);
    expect(entry.msg).toContain("<omis>");
  });

  it("redact laisse intact un message ordinaire", () => {
    expect(redact("session 0f0e0d0c-0b0a-4908-8706-050403020100 prête")).toBe(
      "session 0f0e0d0c-0b0a-4908-8706-050403020100 prête",
    );
  });

  it("le format console reste lisible et masqué", () => {
    const line = formatLog(
      "error",
      "api",
      "échec qtr_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEFG",
      undefined,
      new Date("2026-10-30T10:00:00.000Z"),
    );
    expect(line).toBe("[aqr] 2026-10-30T10:00:00.000Z ERROR api: échec <omis>");
  });
});

describe("sans fichier", () => {
  it("log.info ne plante pas si l'écriture fichier est désactivée", async () => {
    useLogFiles(null);
    expect(() => log.info("init", "ok")).not.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });
});
