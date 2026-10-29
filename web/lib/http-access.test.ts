import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiError, json, safe } from "./http";
import { useLogFiles } from "./log";
import { LogFiles } from "./log-files";

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-access-"));
  useLogFiles(
    new LogFiles({ dir, now: () => new Date("2026-10-30T10:00:00.000Z") }),
  );
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(async () => {
  useLogFiles(null);
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});
const read = async (file: string) =>
  (await readFile(path.join(dir, file), "utf8"))
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

describe("journal d'accès de safe()", () => {
  it("une ligne par requête : méthode, chemin sans requête, statut, durée, identifiant de corrélation", async () => {
    const ok = safe(async () => json({ ok: true }));
    await ok(
      new Request("http://127.0.0.1:3000/api/sessions?q=mon%20secret", {
        headers: { "x-request-id": "rid-1" },
      }),
    );
    const [entry] = await read("access-2026-10-30.log");
    expect(entry).toMatchObject({
      level: "info",
      scope: "access",
      msg: "GET /api/sessions",
      status: 200,
      rid: "rid-1",
    });
    expect(typeof entry.ms).toBe("number");
    expect(JSON.stringify(entry)).not.toContain("secret");
    expect(console.info).not.toHaveBeenCalled(); // pas de bruit d'accès dans la console
  });

  it("refus (401, 403) en warn, erreur serveur en error, avec la même corrélation que l'erreur", async () => {
    const denied = safe(async () => apiError(401, "Connexion requise."));
    const boom = safe(async () => {
      throw new Error("disque plein");
    });
    await denied(
      new Request("http://127.0.0.1:3000/api/me", {
        headers: { "x-request-id": "rid-2" },
      }),
    );
    await boom(
      new Request("http://127.0.0.1:3000/api/x", {
        method: "POST",
        headers: { "x-request-id": "rid-3" },
      }),
    );
    const access = await read("access-2026-10-30.log");
    expect(access[0]).toMatchObject({
      level: "warn",
      msg: "GET /api/me",
      status: 401,
      rid: "rid-2",
    });
    expect(access[1]).toMatchObject({
      level: "error",
      msg: "POST /api/x",
      status: 500,
      rid: "rid-3",
    });
    const app = await read("app-2026-10-30.log");
    expect(app[0]).toMatchObject({
      level: "error",
      scope: "api",
      rid: "rid-3",
    });
  });

  it("sans en-tête du proxy, un identifiant est tout de même créé", async () => {
    await safe(async () => json({}))(
      new Request("http://127.0.0.1:3000/api/x"),
    );
    const [entry] = await read("access-2026-10-30.log");
    expect(entry.rid).toMatch(/^[0-9a-f-]{36}$/);
  });
});
