import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Preuve de la section 2 : la réponse JSON de l'API pour B ne contient rien de la génération privée de A. */
let dir = "";
let tokenA = "";
let tokenB = "";
let GET: typeof import("./route").GET;

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ask = (token: string) =>
  GET(
    new Request("http://127.0.0.1:3000/api/queue", {
      headers: { cookie: `aqr_session=${token}` },
    }),
  );

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-queue-api-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const { createMeta } = await import("@/lib/session-index");
  const db = getDb();
  const a = createUser(db, { username: "awa", passwordHash: "x" });
  const b = createUser(db, { username: "bakary", passwordHash: "x" });
  tokenA = createLogin(db, a.id, authConfig());
  tokenB = createLogin(db, b.id, authConfig());
  const base = {
    nameSource: "auto" as const,
    sourceKind: "file" as const,
    sizeBytes: 1000,
  };
  createMeta(db, {
    ...base,
    id: id(1),
    ownerId: a.id,
    name: "Récitation privée de Awa",
    originalName: "secret-awa.mp3",
    visibility: "private",
    createdAt: "2026-10-01T00:01:00.000Z",
    state: "running",
  });
  createMeta(db, {
    ...base,
    id: id(2),
    ownerId: a.id,
    name: "Autre privée de Awa",
    originalName: "secret2-awa.mp3",
    visibility: "private",
    createdAt: "2026-10-01T00:02:00.000Z",
    state: "queued",
  });
  ({ GET } = await import("./route"));
});
afterAll(async () => {
  vi.unstubAllEnvs();
  const { getDb } = await import("@/lib/db");
  getDb().close();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("GET /api/queue", () => {
  it("refuse une requête sans connexion", async () => {
    const response = await GET(new Request("http://127.0.0.1:3000/api/queue"));
    expect(response.status).toBe(401);
  });

  it("B voit « occupé » et rien de la génération privée de A", async () => {
    const response = await ask(tokenB);
    expect(response.status).toBe(200);
    const text = await response.text();
    const body = JSON.parse(text);
    expect(body.mine).toEqual([]);
    expect(body.others).toEqual({ running: 1, waiting: 1, shared: [] });
    expect(body.message).toBe(
      "Le système est occupé : une génération est en cours et une autre est en attente.",
    );
    for (const secret of ["Awa", "privée", "secret", id(1), id(2)])
      expect(text).not.toContain(secret);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("A voit ses deux jobs, avec la position du second", async () => {
    const body = await (await ask(tokenA)).json();
    expect(body.mine.map((m: { state: string }) => m.state)).toEqual([
      "running",
      "queued",
    ]);
    expect(body.mine[1].position_label).toBe("1re dans la file");
    expect(body.mine[1].eta_label).toBe("estimation indisponible");
    expect(body.others).toEqual({ running: 0, waiting: 0, shared: [] });
  });
});
