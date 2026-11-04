import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ClipUploadError,
  ensureClipOnServer,
  fetchClipLimits,
  removeBackgroundVideo,
  uploadBackgroundVideo,
  type ClipProgress,
} from "./background-video-client";
import { DEFAULT_CLIP_LIMITS } from "./background-video-policy";

/**
 * Client de la vidéo de fond (navigateur). Un faux serveur (fetch simulé) reproduit les routes
 * `/api/sessions/:id/background-videos` ; on y coupe le réseau, on y refuse, on y annule, pour vérifier la
 * reprise, la progression et les explications.
 */
const CHUNK = 1000;
const SESSION = "11111111-1111-4111-8111-111111111111";
const BASE = `/api/sessions/${SESSION}/background-videos`;
type Call = { method: string; url: string; body?: unknown; size?: number };

class FakeServer {
  calls: Call[] = [];
  received = new Map<number, number>();
  /** Règles appelées en premier : une réponse, « network » (coupure) ou null (laisser faire). */
  rules: Array<(call: Call) => Response | "network" | null> = [];
  /** États successifs rendus par `GET …/<id>` après l'assemblage. */
  states: Array<Record<string, unknown>> = [];
  completeStatus = 202;
  forgotten = false;
  deleted = false;

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? "GET").toUpperCase();
    const body = init.body;
    const call: Call = {
      method,
      url,
      body: typeof body === "string" ? JSON.parse(body) : undefined,
      size: body instanceof Blob ? body.size : undefined,
    };
    this.calls.push(call);
    for (const rule of this.rules) {
      const verdict = rule(call);
      if (verdict === "network") throw new TypeError("Failed to fetch");
      if (verdict) return verdict;
    }
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (method === "GET" && url === BASE)
      return json({
        limits: { max_bytes: 50_000, max_seconds: 120, max_clips: 3 },
        videos: [],
      });
    if (method === "POST" && url === BASE) {
      const total = (call.body as { size: number }).size;
      return json(
        {
          id: "v".repeat(32),
          chunk_size: CHUNK,
          chunks: Math.ceil(total / CHUNK),
          size: total,
          limits: { max_bytes: 50_000, max_seconds: 120, max_clips: 3 },
        },
        201,
      );
    }
    const chunk = new RegExp(`^${BASE}/v{32}/chunks/(\\d+)$`).exec(url);
    if (method === "PUT" && chunk) {
      this.received.set(Number(chunk[1]), call.size ?? 0);
      return json({ received: this.received.size, chunks: 0 });
    }
    if (method === "POST" && url === `${BASE}/${"v".repeat(32)}/complete`)
      return json(
        { id: "v".repeat(32), state: "processing", ratio: 0 },
        this.completeStatus,
      );
    if (method === "GET" && url === `${BASE}/${"v".repeat(32)}`) {
      if (this.forgotten)
        return json({ error: "inconnue", code: "missing" }, 404);
      const state = this.states.shift() ?? { state: "ready" };
      return json({
        id: "v".repeat(32),
        name: "mer.mp4",
        chunk_size: CHUNK,
        chunks: 4,
        received: [...this.received.keys()],
        duration: 12,
        width: 1280,
        height: 720,
        ratio: 1,
        ...state,
      });
    }
    if (method === "DELETE" && url === `${BASE}/${"v".repeat(32)}`) {
      this.deleted = true;
      return json({ ok: true });
    }
    return json({ error: "inattendu" }, 404);
  };
  puts = () => this.calls.filter((c) => c.method === "PUT").map((c) => c.url);
  deletes = () => this.calls.filter((c) => c.method === "DELETE");
}

let server: FakeServer;
const noSleep = vi.fn(async () => undefined);
const clip = (size: number, name = "mer.mp4") =>
  new File([new Uint8Array(size)], name, { type: "video/mp4" });
const io = (over: Record<string, unknown> = {}) => ({
  sleep: noSleep,
  pollMs: 1,
  ...over,
});

beforeEach(() => {
  server = new FakeServer();
  vi.stubGlobal("fetch", server.fetch);
  noSleep.mockClear();
});

describe("plafonds lus sur le serveur", () => {
  it("rend les plafonds du serveur, pour les dire avant le choix du fichier", async () => {
    expect(await fetchClipLimits(SESSION)).toEqual({
      maxBytes: 50_000,
      maxSeconds: 120,
      maxClips: 3,
    });
  });

  it("si le serveur ne répond pas, retombe sur les plafonds par défaut sans planter", async () => {
    server.rules.push(() => "network");
    expect(await fetchClipLimits(SESSION)).toEqual(DEFAULT_CLIP_LIMITS);
  });
});

describe("envoi, préparation, résultat", () => {
  it("crée l'envoi, envoie chaque morceau une fois, assemble, attend la préparation, rend la vidéo prête", async () => {
    server.states = [
      { state: "processing", ratio: 0.3 },
      { state: "processing", ratio: 0.8 },
      { state: "ready", ratio: 1 },
    ];
    const clipView = await uploadBackgroundVideo(SESSION, clip(3200), io());
    expect(clipView).toMatchObject({
      id: "v".repeat(32),
      state: "ready",
      duration: 12,
    });
    expect(server.puts()).toHaveLength(4);
    expect(new Set(server.puts()).size).toBe(4);
    const create = server.calls.find(
      (c) => c.method === "POST" && c.url === BASE,
    );
    expect(create?.body).toEqual({ filename: "mer.mp4", size: 3200 });
    expect(server.deletes()).toEqual([]);
  });

  it("la progression : l'envoi monte, puis la préparation, sans reculer dans une même phase", async () => {
    server.states = [
      { state: "processing", ratio: 0.25 },
      { state: "processing", ratio: 0.75 },
      { state: "ready" },
    ];
    const seen: ClipProgress[] = [];
    await uploadBackgroundVideo(SESSION, clip(3200), {
      ...io(),
      onProgress: (p: ClipProgress) => seen.push(p),
    });
    const sending = seen
      .filter((p) => p.phase === "sending")
      .map((p) => p.ratio);
    const preparing = seen
      .filter((p) => p.phase === "preparing")
      .map((p) => p.ratio);
    expect(sending.length).toBeGreaterThan(0);
    expect(sending).toEqual([...sending].sort((a, b) => a - b));
    expect(sending.at(-1)).toBe(1);
    expect(preparing).toEqual([0.25, 0.75]);
    // l'ordre : tout l'envoi avant toute préparation
    const firstPrep = seen.findIndex((p) => p.phase === "preparing");
    expect(seen.slice(firstPrep).every((p) => p.phase === "preparing")).toBe(
      true,
    );
  });

  it("un fichier trop lourd ou d'un mauvais format est refusé AVANT d'envoyer le moindre octet", async () => {
    await expect(
      uploadBackgroundVideo(SESSION, clip(60_000), io()),
    ).rejects.toMatchObject({ code: "too_big" });
    await expect(
      uploadBackgroundVideo(SESSION, clip(100, "notes.txt"), io()),
    ).rejects.toMatchObject({ code: "format" });
    await expect(
      uploadBackgroundVideo(SESSION, clip(0), io()),
    ).rejects.toMatchObject({ code: "empty" });
    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("la durée connue de la vidéo, trop longue, est refusée avant l'envoi", async () => {
    await expect(
      uploadBackgroundVideo(SESSION, clip(2000), io({ seconds: 500 })),
    ).rejects.toMatchObject({ code: "too_long" });
    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });
});

describe("refus du serveur : dits en clair, jamais un code brut", () => {
  const refuse = (status: number, code: string, error: string) => () =>
    new Response(JSON.stringify({ error, code }), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("refus à la création (trop de vidéos, disque plein) : rien n'est envoyé", async () => {
    server.rules.push((c) =>
      c.method === "POST" && c.url === BASE
        ? refuse(
            409,
            "too_many",
            "Tu as déjà 3 vidéos de fond sur le serveur.",
          )()
        : null,
    );
    await expect(
      uploadBackgroundVideo(SESSION, clip(2000), io()),
    ).rejects.toMatchObject({ code: "too_many" });
    expect(server.puts()).toEqual([]);
  });

  it("refus à l'assemblage (contenu qui n'est pas une vidéo) : l'explication du serveur est rendue", async () => {
    server.rules.push((c) =>
      c.url.endsWith("/complete")
        ? refuse(415, "format", "Ce format de fichier n'est pas accepté.")()
        : null,
    );
    const error = await uploadBackgroundVideo(SESSION, clip(2000), io()).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ClipUploadError);
    expect(error.code).toBe("format");
    expect(error.message).toContain("pas accepté");
  });

  it.each([
    [415, "format"],
    [422, "unreadable"],
    [413, "too_long"],
    [400, "interrupted"],
  ])(
    "refus à l'assemblage (%i %s) : le serveur a déjà supprimé la vidéo, le client ne redemande pas (pas de 404 en console)",
    async (status, code) => {
      server.rules.push((c) =>
        c.url.endsWith("/complete") ? refuse(status, code, "Refusée.")() : null,
      );
      await expect(
        uploadBackgroundVideo(SESSION, clip(2000), io()),
      ).rejects.toMatchObject({ code });
      expect(server.deletes()).toEqual([]);
    },
  );

  it.each([
    [409, "not_ready"],
    [503, "server"],
    [507, "disk_full"],
  ])(
    "échec à l'assemblage (%i %s) : la vidéo peut rester sur le serveur, le client la retire",
    async (status, code) => {
      server.rules.push((c) =>
        c.url.endsWith("/complete") ? refuse(status, code, "Échec.")() : null,
      );
      await expect(
        uploadBackgroundVideo(SESSION, clip(2000), io()),
      ).rejects.toMatchObject({ code });
      expect(server.deletes()).toHaveLength(1);
    },
  );

  it("préparation échouée : l'état « échec » devient une erreur expliquée, et la vidéo est retirée du serveur", async () => {
    server.states = [
      {
        state: "failed",
        failure: "unreadable",
        message: "Cette vidéo est illisible ou abîmée.",
      },
    ];
    const error = await uploadBackgroundVideo(SESSION, clip(2000), io()).catch(
      (e) => e,
    );
    expect(error.code).toBe("unreadable");
    expect(error.message).toContain("illisible");
    expect(server.deleted).toBe(true);
  });
});

describe("coupure de réseau et reprise", () => {
  it("un morceau perdu est renvoyé seul, les autres ne sont pas renvoyés", async () => {
    let failed = false;
    server.rules.push((c) => {
      if (c.method === "PUT" && c.url.endsWith("/chunks/2") && !failed) {
        failed = true;
        return "network";
      }
      return null;
    });
    await uploadBackgroundVideo(SESSION, clip(3200), io());
    const sent = server.puts().filter((u) => u.endsWith("/chunks/2"));
    expect(sent).toHaveLength(2); // un essai perdu + un renvoi
    expect(server.puts().filter((u) => !u.endsWith("/chunks/2"))).toHaveLength(
      3,
    );
  });

  it("réseau coupé pour de bon : « network », l'envoi est GARDÉ sur le serveur pour reprendre", async () => {
    server.rules.push((c) => (c.method === "PUT" ? "network" : null));
    const error = await uploadBackgroundVideo(
      SESSION,
      clip(3200),
      io({ retries: 1 }),
    ).catch((e) => e);
    expect(error.code).toBe("network");
    expect(error.resumeId).toBe("v".repeat(32));
    expect(error.message).toMatch(/réseau/i);
    expect(server.deletes()).toEqual([]);
  });

  it("reprendre : ne renvoie que ce qui manque, puis termine", async () => {
    server.received.set(0, CHUNK);
    server.received.set(1, CHUNK);
    server.states = [{ state: "uploading" }]; // ce que le serveur répond à la demande d'état de la reprise
    const view = await uploadBackgroundVideo(
      SESSION,
      clip(3200),
      io({ resumeId: "v".repeat(32) }),
    );
    expect(view.state).toBe("ready");
    expect(server.puts().sort()).toEqual([
      `${BASE}/${"v".repeat(32)}/chunks/2`,
      `${BASE}/${"v".repeat(32)}/chunks/3`,
    ]);
    expect(
      server.calls.some((c) => c.method === "POST" && c.url === BASE),
    ).toBe(false);
  });

  it("reprendre alors que le serveur a tout oublié (expirée) : on recommence un envoi neuf", async () => {
    server.forgotten = true;
    server.rules.push((c) => {
      // après la création neuve, le serveur « se souvient » de nouveau
      if (c.method === "POST" && c.url === BASE) server.forgotten = false;
      return null;
    });
    const view = await uploadBackgroundVideo(
      SESSION,
      clip(2000),
      io({ resumeId: "v".repeat(32) }),
    );
    expect(view.state).toBe("ready");
    expect(
      server.calls.some((c) => c.method === "POST" && c.url === BASE),
    ).toBe(true);
  });

  it("reprendre une préparation déjà en cours : ne renvoie rien, attend la fin", async () => {
    server.states = [{ state: "processing", ratio: 0.5 }, { state: "ready" }];
    const view = await uploadBackgroundVideo(
      SESSION,
      clip(3200),
      io({ resumeId: "v".repeat(32) }),
    );
    expect(view.state).toBe("ready");
    expect(server.puts()).toEqual([]);
  });

  it("une coupure brève pendant l'attente de la préparation est tolérée", async () => {
    let cuts = 0;
    server.rules.push((c) => {
      if (c.method === "GET" && c.url.endsWith("v".repeat(32)) && cuts < 2) {
        cuts += 1;
        return "network";
      }
      return null;
    });
    const view = await uploadBackgroundVideo(SESSION, clip(2000), io());
    expect(view.state).toBe("ready");
  });

  it("une longue coupure pendant la préparation : « network » avec de quoi reprendre l'attente", async () => {
    server.rules.push((c) =>
      c.method === "GET" && c.url.endsWith("v".repeat(32)) ? "network" : null,
    );
    const error = await uploadBackgroundVideo(SESSION, clip(2000), io()).catch(
      (e) => e,
    );
    expect(error.code).toBe("network");
    expect(error.resumeId).toBe("v".repeat(32));
    expect(server.deletes()).toEqual([]);
  });
});

describe("avant un export : la vidéo est-elle toujours sur le serveur ?", () => {
  const id = "v".repeat(32);

  it("prête : rien n'est renvoyé", async () => {
    const view = await ensureClipOnServer(
      SESSION,
      { uploadId: id, file: clip(2000) },
      io(),
    );
    expect(view).toMatchObject({ id, state: "ready" });
    expect(server.calls.filter((c) => c.method !== "GET")).toEqual([]);
  });

  it("encore en préparation : on attend la fin, sans rien renvoyer", async () => {
    server.states = [
      { state: "processing", ratio: 0.2 },
      { state: "processing", ratio: 0.9 },
      { state: "ready" },
    ];
    const view = await ensureClipOnServer(
      SESSION,
      { uploadId: id, file: clip(2000) },
      io(),
    );
    expect(view.state).toBe("ready");
    expect(server.puts()).toEqual([]);
  });

  it("disparue (expirée, supprimée) : renvoyée depuis le fichier gardé par l'écran, avec un nouvel identifiant", async () => {
    server.forgotten = true;
    server.rules.push((c) => {
      if (c.method === "POST" && c.url === BASE) server.forgotten = false;
      return null;
    });
    const view = await ensureClipOnServer(
      SESSION,
      { uploadId: "x".repeat(32), file: clip(2000) },
      io(),
    );
    expect(view.state).toBe("ready");
    expect(server.puts().length).toBeGreaterThan(0);
  });

  it("l'envoi d'avant a échoué : il est retiré, puis la vidéo est renvoyée", async () => {
    server.states = [
      { state: "failed", failure: "unreadable", message: "illisible" },
    ];
    const view = await ensureClipOnServer(
      SESSION,
      { uploadId: id, file: clip(2000) },
      io(),
    );
    expect(view.state).toBe("ready");
    expect(server.deleted).toBe(true);
    expect(server.puts().length).toBeGreaterThan(0);
  });
});

describe("annulation et retrait", () => {
  it("annuler pendant l'envoi : l'envoi s'arrête et le serveur supprime ce qu'il avait reçu", async () => {
    const controller = new AbortController();
    server.rules.push((c) => {
      if (c.method === "PUT" && c.url.endsWith("/chunks/1")) controller.abort();
      return null;
    });
    const error = await uploadBackgroundVideo(SESSION, clip(8000), {
      ...io({ parallel: 1 }),
      signal: controller.signal,
    }).catch((e) => e);
    expect(error.code).toBe("interrupted");
    expect(server.deleted).toBe(true);
    expect(server.puts().length).toBeLessThan(8);
  });

  it("annuler pendant la préparation : la vidéo est retirée du serveur", async () => {
    const controller = new AbortController();
    server.states = [{ state: "processing", ratio: 0.1 }];
    const error = await uploadBackgroundVideo(SESSION, clip(2000), {
      ...io(),
      signal: controller.signal,
      onProgress: (p: ClipProgress) => {
        if (p.phase === "preparing") controller.abort();
      },
    }).catch((e) => e);
    expect(error.code).toBe("interrupted");
    expect(server.deleted).toBe(true);
  });

  it("retirer une vidéo : la supprime sur le serveur ; déjà disparue, ce n'est pas une erreur", async () => {
    await removeBackgroundVideo(SESSION, "v".repeat(32));
    expect(server.deleted).toBe(true);
    server.rules.push(
      () =>
        new Response(JSON.stringify({ error: "inconnue", code: "missing" }), {
          status: 404,
        }),
    );
    await expect(
      removeBackgroundVideo(SESSION, "v".repeat(32)),
    ).resolves.toBeUndefined();
  });
});
