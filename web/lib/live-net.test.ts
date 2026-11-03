import { describe, expect, it, vi } from "vitest";
import { SMALL_UPLOAD_BYTES, uploadInChunks } from "./chunked-upload-client";
import { fetchLiveToken, keepRecording, type XhrLike } from "./live-net";

// Les longs enregistrements passent par l'envoi par morceaux (testé à part) : ici, seule l'aiguillage compte.
vi.mock("./chunked-upload-client", async (original) => ({
  ...(await original<typeof import("./chunked-upload-client")>()),
  uploadInChunks: vi.fn(),
}));

const reply = (status: number, body: unknown, headers: HeadersInit = {}) =>
  (async () =>
    new Response(JSON.stringify(body), { status, headers })) as typeof fetch;

describe("fetchLiveToken", () => {
  it("rend le jeton et l'adresse du service", async () => {
    const result = await fetchLiveToken(
      true,
      reply(200, {
        schema: "aqr.live/1",
        token: "v1.a.b",
        url: "ws://127.0.0.1:8765/live",
        technical: true,
        ttl_s: 60,
      }),
    );
    expect(result).toEqual({
      ok: true,
      token: "v1.a.b",
      url: "ws://127.0.0.1:8765/live",
      technical: true,
    });
  });
  it("un 401 devient 'unauthenticated' même sans code", async () => {
    const result = await fetchLiveToken(
      false,
      reply(401, { error: "Connexion requise." }),
    );
    expect(result).toMatchObject({
      ok: false,
      status: 401,
      code: "unauthenticated",
    });
  });
  it("garde le délai conseillé d'un 429", async () => {
    const result = await fetchLiveToken(
      false,
      reply(
        429,
        { error: "Trop vite", code: "rate_limited" },
        { "Retry-After": "7" },
      ),
    );
    expect(result).toMatchObject({ ok: false, status: 429, retryAfterS: 7 });
  });
  it("réseau coupé : status 0, message lisible", async () => {
    const result = await fetchLiveToken(false, (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    expect(result).toMatchObject({ ok: false, status: 0, code: "network" });
    if (!result.ok) expect(result.message).toMatch(/réseau/);
  });
  it("un 200 sans jeton n'est pas un succès", async () => {
    const result = await fetchLiveToken(false, reply(200, { url: "ws://x" }));
    expect(result.ok).toBe(false);
  });
});

function fakeXhr() {
  const state = {
    headers: {} as Record<string, string>,
    url: "",
    sent: null as Blob | null,
  };
  const xhr: XhrLike & { finish: (status: number, body: unknown) => void } = {
    status: 0,
    responseText: "",
    upload: { onprogress: null },
    onload: null,
    onerror: null,
    onabort: null,
    open: (_m, url) => {
      state.url = url;
    },
    setRequestHeader: (k, v) => {
      state.headers[k] = v;
    },
    send: (body) => {
      state.sent = body;
    },
    finish(status, body) {
      xhr.status = status;
      xhr.responseText = JSON.stringify(body);
      xhr.onload?.();
    },
  };
  return { xhr, state };
}

describe("keepRecording", () => {
  const file = new File([new Uint8Array(10)], "rec ordinaire.webm", {
    type: "audio/webm",
  });
  it("envoie comme un import classique (source microphone) et suit la progression réelle", async () => {
    const { xhr, state } = fakeXhr();
    const seen: number[] = [];
    const promise = keepRecording(
      file,
      { visibility: "private", name: "Récitation en direct, 14:32" },
      (f) => seen.push(f),
      () => xhr,
    );
    xhr.upload.onprogress?.({ loaded: 5, total: 10 });
    xhr.finish(201, { id: "abc" });
    await expect(promise).resolves.toEqual({
      id: "abc",
      autorunError: undefined,
    });
    expect(state.url).toBe("/api/sessions?autorun=1&visibility=private");
    expect(state.headers["x-aqr-source-kind"]).toBe("microphone");
    expect(decodeURIComponent(state.headers["x-aqr-name"])).toBe(
      "Récitation en direct, 14:32",
    );
    expect(state.headers["content-type"]).toBe("audio/webm");
    expect(seen).toEqual([0.5, 1]);
  });
  it("un refus du serveur est dit en clair ; l'enregistrement reste", async () => {
    const { xhr } = fakeXhr();
    const promise = keepRecording(
      file,
      { visibility: "global", name: "x" },
      () => {},
      () => xhr,
    );
    xhr.finish(413, { error: "Quota atteint : tu utilises 5 Gio sur 5 Gio." });
    await expect(promise).rejects.toThrow(/Quota atteint/);
  });
  it("une connexion expirée ne perd pas le son", async () => {
    const { xhr } = fakeXhr();
    const promise = keepRecording(
      file,
      { visibility: "global", name: "x" },
      () => {},
      () => xhr,
    );
    xhr.finish(401, { code: "unauthenticated" });
    await expect(promise).rejects.toThrow(/reste dans cette page/);
  });
  it("réseau coupé en plein envoi", async () => {
    const { xhr } = fakeXhr();
    const promise = keepRecording(
      file,
      { visibility: "global", name: "x" },
      () => {},
      () => xhr,
    );
    xhr.onerror?.();
    await expect(promise).rejects.toThrow(/réseau/);
  });

  it("un long enregistrement part par morceaux (source microphone, nom choisi), sans XHR", async () => {
    vi.mocked(uploadInChunks).mockResolvedValue({ id: "s9" });
    const big = new File([new Uint8Array(SMALL_UPLOAD_BYTES + 1)], "live.webm");
    const progress = () => undefined;
    const result = await keepRecording(
      big,
      { visibility: "private", name: "Récitation en direct, 14:08" },
      progress,
      () => {
        throw new Error("aucun XHR pour un long enregistrement");
      },
    );
    expect(result).toEqual({ id: "s9" });
    expect(uploadInChunks).toHaveBeenCalledWith(
      big,
      {
        visibility: "private",
        sourceKind: "microphone",
        name: "Récitation en direct, 14:08",
      },
      { onProgress: progress },
    );
  });

  it("un court enregistrement reste en une requête", async () => {
    vi.mocked(uploadInChunks).mockClear();
    const { xhr } = fakeXhr();
    const promise = keepRecording(
      new File([new Uint8Array(10)], "court.webm"),
      { visibility: "global", name: "x" },
      () => {},
      () => xhr,
    );
    xhr.onerror?.();
    await expect(promise).rejects.toThrow(/réseau/);
    expect(uploadInChunks).not.toHaveBeenCalled();
  });
});
