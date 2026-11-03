import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadInChunks, SMALL_UPLOAD_BYTES } from "./chunked-upload-client";

/**
 * Client d'envoi par morceaux. Un faux serveur (fetch simulé) reproduit les routes /api/uploads ; on y fait
 * tomber des morceaux pour vérifier la reprise, sans jamais renvoyer ce qui est déjà passé.
 */
const CHUNK = 1000;
type Call = { method: string; url: string; body?: unknown; size?: number };

class FakeServer {
  calls: Call[] = [];
  received = new Map<number, number>(); // numéro -> taille reçue
  failures: Array<(call: Call) => Response | "network" | null> = [];
  completeBody: unknown = { id: "session-1" };
  completeStatus = 201;
  deleted = false;

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body;
    const size = body instanceof Blob ? body.size : undefined;
    const call: Call = {
      method,
      url,
      body: typeof body === "string" ? JSON.parse(body) : undefined,
      size,
    };
    this.calls.push(call);
    for (const rule of this.failures) {
      const verdict = rule(call);
      if (verdict === "network") throw new TypeError("Failed to fetch");
      if (verdict) return verdict;
    }
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (method === "POST" && url === "/api/uploads") {
      const total = (call.body as { size: number }).size;
      return json(
        {
          id: "up1",
          chunk_size: CHUNK,
          chunks: Math.ceil(total / CHUNK),
          size: total,
          expires_in_s: 86400,
        },
        201,
      );
    }
    const chunk = /^\/api\/uploads\/up1\/chunks\/(\d+)$/.exec(url);
    if (method === "PUT" && chunk) {
      this.received.set(Number(chunk[1]), size ?? 0);
      return json({ received: this.received.size, chunks: 0 });
    }
    if (method === "POST" && url === "/api/uploads/up1/complete")
      return json(this.completeBody, this.completeStatus);
    if (method === "DELETE" && url === "/api/uploads/up1") {
      this.deleted = true;
      return json({ ok: true });
    }
    return json({ error: "inattendu" }, 404);
  };
  puts = () => this.calls.filter((c) => c.method === "PUT").map((c) => c.url);
}

let server: FakeServer;
const noSleep = vi.fn(async () => undefined);
const fileOf = (size: number, name = "fatiha.webm") =>
  new File([new Uint8Array(size)], name, { type: "audio/webm" });
const base = {
  visibility: "private" as const,
  sourceKind: "microphone" as const,
};

beforeEach(() => {
  server = new FakeServer();
  vi.stubGlobal("fetch", server.fetch);
  noSleep.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("déroulement", () => {
  it("crée l'envoi, envoie chaque morceau exactement une fois, puis assemble", async () => {
    const file = fileOf(CHUNK * 3 + 250);
    const result = await uploadInChunks(
      file,
      { ...base, name: "Fatiha" },
      { sleep: noSleep },
    );
    expect(result).toEqual({ id: "session-1", autorunError: undefined });
    expect(server.calls[0]).toMatchObject({
      method: "POST",
      url: "/api/uploads",
      body: {
        filename: "fatiha.webm",
        size: CHUNK * 3 + 250,
        source_kind: "microphone",
        visibility: "private",
        name: "Fatiha",
        autorun: true,
      },
    });
    expect(server.puts().sort()).toEqual(
      [0, 1, 2, 3].map((n) => `/api/uploads/up1/chunks/${n}`),
    );
    expect([...server.received.entries()].sort()).toEqual([
      [0, CHUNK],
      [1, CHUNK],
      [2, CHUNK],
      [3, 250],
    ]);
    expect(server.calls.at(-1)).toMatchObject({
      method: "POST",
      url: "/api/uploads/up1/complete",
    });
  });

  it("rend l'erreur de mise en file de l'analyse, sans perdre l'envoi", async () => {
    server.completeBody = { id: "s2", autorun_error: "File pleine" };
    const result = await uploadInChunks(fileOf(CHUNK + 1), base, {
      sleep: noSleep,
    });
    expect(result).toEqual({ id: "s2", autorunError: "File pleine" });
  });

  it("la progression monte jusqu'à 1 sans jamais reculer", async () => {
    const seen: number[] = [];
    await uploadInChunks(fileOf(CHUNK * 5), base, {
      sleep: noSleep,
      onProgress: (f) => seen.push(f),
    });
    expect(seen.at(-1)).toBe(1);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
  });

  it("limite le nombre de morceaux envoyés en même temps", async () => {
    let active = 0;
    let peak = 0;
    const original = server.fetch;
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const isChunk = /chunks\/\d+$/.test(String(input));
        if (isChunk) {
          active++;
          peak = Math.max(peak, active);
          await new Promise((r) => setTimeout(r, 5));
        }
        try {
          return await original(input, init);
        } finally {
          if (isChunk) active--;
        }
      },
    );
    await uploadInChunks(fileOf(CHUNK * 12), base, {
      sleep: noSleep,
      parallel: 3,
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });
});

describe("reprise", () => {
  it("un morceau qui échoue (réseau) est renvoyé seul, les autres ne sont pas renvoyés", async () => {
    let dropped = 0;
    server.failures.push((c) => {
      if (c.method === "PUT" && c.url.endsWith("/chunks/2") && dropped++ < 2)
        return "network";
      return null;
    });
    const result = await uploadInChunks(fileOf(CHUNK * 4), base, {
      sleep: noSleep,
    });
    expect(result.id).toBe("session-1");
    const attempts = server
      .puts()
      .filter((u) => u.endsWith("/chunks/2")).length;
    expect(attempts).toBe(3); // deux échecs, un succès
    for (const n of [0, 1, 3])
      expect(
        server.puts().filter((u) => u.endsWith(`/chunks/${n}`)),
      ).toHaveLength(1);
    expect(noSleep).toHaveBeenCalled(); // une attente entre les essais
  });

  it("une erreur serveur passagère (503, 429) est retentée", async () => {
    let n = 0;
    server.failures.push((c) => {
      if (c.method === "PUT" && n++ < 2)
        return new Response(JSON.stringify({ error: "occupé" }), {
          status: n === 1 ? 503 : 429,
          headers: { "content-type": "application/json" },
        });
      return null;
    });
    await expect(
      uploadInChunks(fileOf(CHUNK * 2), base, { sleep: noSleep }),
    ).resolves.toMatchObject({ id: "session-1" });
  });

  it("le délai d'attente croît entre les essais, borné", async () => {
    server.failures.push((c) => (c.method === "PUT" ? "network" : null));
    const waits: number[] = [];
    await expect(
      uploadInChunks(fileOf(CHUNK), base, {
        sleep: async (ms) => void waits.push(ms),
        retries: 5,
      }),
    ).rejects.toThrow();
    expect(waits).toHaveLength(5);
    expect(waits).toEqual([...waits].sort((a, b) => a - b));
    expect(Math.max(...waits)).toBeLessThanOrEqual(15_000);
    expect(waits[0]).toBeGreaterThanOrEqual(500);
  });
});

describe("échecs définitifs", () => {
  it("après tous les essais : message lisible, envoi abandonné côté serveur", async () => {
    server.failures.push((c) => (c.method === "PUT" ? "network" : null));
    await expect(
      uploadInChunks(fileOf(CHUNK * 2), base, { sleep: noSleep, retries: 2 }),
    ).rejects.toThrow(/Connexion au serveur impossible/);
    expect(server.deleted).toBe(true);
  });

  it("un refus définitif (413 quota, 400, mode restreint) n'est jamais retenté", async () => {
    for (const status of [413, 400, 403, 404, 503]) {
      server = new FakeServer();
      vi.stubGlobal("fetch", server.fetch);
      server.failures.push((c) =>
        c.method === "PUT"
          ? new Response(
              JSON.stringify({
                error: "Refusé.",
                code: status === 503 ? "restricted" : "invalid",
              }),
              { status, headers: { "content-type": "application/json" } },
            )
          : null,
      );
      await expect(
        uploadInChunks(fileOf(CHUNK * 2), base, { sleep: noSleep }),
      ).rejects.toThrow(/Refusé/);
      const attempts = server.puts().length;
      expect(attempts, String(status)).toBeLessThanOrEqual(3); // au plus les morceaux lancés en parallèle, sans réessai
      expect(noSleep).not.toHaveBeenCalled();
    }
  });

  it("refus dès la création (quota, type) : rien n'est envoyé", async () => {
    server.failures.push((c) =>
      c.url === "/api/uploads"
        ? new Response(
            JSON.stringify({ error: "Quota atteint.", code: "too_large" }),
            { status: 413, headers: { "content-type": "application/json" } },
          )
        : null,
    );
    await expect(
      uploadInChunks(fileOf(CHUNK * 2), base, { sleep: noSleep }),
    ).rejects.toThrow(/Quota atteint/);
    expect(server.puts()).toEqual([]);
  });

  it("l'assemblage : un 409 (morceau manquant) renvoie les morceaux annoncés manquants, puis réussit", async () => {
    let first = true;
    server.failures.push((c) => {
      if (c.url.endsWith("/complete") && first) {
        first = false;
        return new Response(
          JSON.stringify({
            error: "Il manque des morceaux",
            code: "incomplete",
          }),
          { status: 409, headers: { "content-type": "application/json" } },
        );
      }
      if (c.method === "GET" && c.url === "/api/uploads/up1")
        return new Response(JSON.stringify({ received: [0, 2], chunks: 3 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return null;
    });
    const result = await uploadInChunks(fileOf(CHUNK * 3), base, {
      sleep: noSleep,
    });
    expect(result.id).toBe("session-1");
    // le morceau 1 (le seul manquant selon le serveur) a été renvoyé
    expect(
      server.puts().filter((u) => u.endsWith("/chunks/1")).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("l'envoi peut être annulé : il s'arrête et le serveur est prévenu", async () => {
    const controller = new AbortController();
    server.failures.push((c) => {
      if (c.method === "PUT" && c.url.endsWith("/chunks/1")) controller.abort();
      return null;
    });
    await expect(
      uploadInChunks(fileOf(CHUNK * 8), base, {
        sleep: noSleep,
        parallel: 1,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/interrompu/i);
    expect(server.deleted).toBe(true);
    expect(server.calls.some((c) => c.url.endsWith("/complete"))).toBe(false);
  });
});

describe("petits fichiers", () => {
  it("le seuil d'un envoi en une requête est fixé", () => {
    expect(SMALL_UPLOAD_BYTES).toBe(2 * 1024 * 1024);
  });
});
