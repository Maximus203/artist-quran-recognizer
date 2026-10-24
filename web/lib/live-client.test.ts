import { describe, expect, it } from "vitest";
import { LiveClient, type LiveDeps, type SocketLike } from "./live-client";
import { LIVE_UI } from "./live-config";
import type { LiveAction } from "./live-store";

// ───────── Faux réseau, fausse horloge : tout est déterministe ─────────
class FakeSocket implements SocketLike {
  readyState = 0;
  bufferedAmount = 0;
  sent: (string | Uint8Array)[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly url: string) {}
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close(code = 1000) {
    this.closedWith = code;
    this.readyState = 3;
  }
  // — côté « serveur » —
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  say(message: Record<string, unknown>) {
    this.onmessage?.({
      data: JSON.stringify({ schema: "aqr.live/1", t: 0, ...message }),
    });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  get texts(): Record<string, unknown>[] {
    return this.sent
      .filter((x): x is string => typeof x === "string")
      .map((x) => JSON.parse(x));
  }
  get audio(): Uint8Array[] {
    return this.sent.filter((x): x is Uint8Array => typeof x !== "string");
  }
  get audioSamples(): number {
    return this.audio.reduce((n, b) => n + b.byteLength / 2, 0);
  }
}

function harness(
  over: Partial<{
    tokens: (n: number) => ReturnType<LiveDeps["fetchToken"]>;
  }> = {},
) {
  let clock = 1_000_000;
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextTimer = 1;
  const sockets: FakeSocket[] = [];
  const actions: LiveAction[] = [];
  let tokenCalls = 0;
  const deps: LiveDeps = {
    now: () => clock,
    setTimer: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { at: clock + ms, fn });
      return id;
    },
    clearTimer: (id) => {
      timers.delete(id as number);
    },
    openSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    fetchToken: async () => {
      tokenCalls += 1;
      return over.tokens
        ? over.tokens(tokenCalls)
        : {
            ok: true,
            token: `jeton-${tokenCalls}`,
            url: "ws://127.0.0.1:8765/live",
            technical: false,
          };
    },
    dispatch: (action) => actions.push(action),
    options: { translation: "french_hameedullah", technical: false },
  };
  const advance = async (ms: number) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = Math.max(clock, due[1].at);
      due[1].fn();
      await Promise.resolve();
    }
    clock = end;
    await Promise.resolve();
  };
  const flush = async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  };
  const client = new LiveClient(deps);
  const block = (fill: number, samples = 1600) =>
    new Uint8Array(samples * 2).fill(fill);
  return {
    client,
    sockets,
    actions,
    advance,
    flush,
    block,
    get tokenCalls() {
      return tokenCalls;
    },
    get last() {
      return sockets[sockets.length - 1];
    },
    kinds: () => actions.map((a) => a.type),
    /** Démarre jusqu'à READY. */
    async ready(extra: Record<string, unknown> = {}) {
      client.open();
      await flush();
      const socket = sockets[sockets.length - 1];
      socket.open();
      socket.say({
        type: "READY",
        seq: 0,
        session_id: "S1",
        resumed: false,
        last_seq: 0,
        audio_received_samples: 0,
        degraded: [],
        technical: false,
        resume_ttl_s: 30,
        ...extra,
      });
      await flush();
      return socket;
    },
  };
}

describe("démarrage", () => {
  it("demande un jeton, ouvre le socket, envoie START avec le jeton et le format exact", async () => {
    const h = harness();
    h.client.open();
    await h.flush();
    expect(h.sockets).toHaveLength(1);
    expect(h.last.url).toBe("ws://127.0.0.1:8765/live");
    h.last.open();
    const [start] = h.last.texts;
    expect(start).toMatchObject({
      type: "START",
      schema: "aqr.live/1",
      token: "jeton-1",
      audio: { encoding: "pcm_s16le", sample_rate: 16000, channels: 1 },
      options: { translation: "french_hameedullah", technical: false },
    });
    expect(start).not.toHaveProperty("resume");
  });

  it("aucun son ne part avant READY ; le son capté entre-temps est envoyé ensuite, dans l'ordre", async () => {
    const h = harness();
    h.client.open();
    await h.flush();
    h.last.open();
    h.client.onAudio(h.block(1), 0.2);
    h.client.onAudio(h.block(2), 0.2);
    expect(h.last.audio).toEqual([]);
    h.last.say({
      type: "READY",
      seq: 0,
      session_id: "S1",
      resumed: false,
      last_seq: 0,
      audio_received_samples: 0,
      degraded: [],
      technical: false,
      resume_ttl_s: 30,
    });
    await h.flush();
    expect(h.last.audio.map((b) => b[0])).toEqual([1, 2]);
    h.client.onAudio(h.block(3), 0.2);
    expect(h.last.audio.map((b) => b[0])).toEqual([1, 2, 3]);
    expect(h.last.audio.every((b) => b.byteLength % 2 === 0)).toBe(true);
  });

  it("jeton refusé (non connecté) : écran 'connexion expirée', aucun socket", async () => {
    const h = harness({
      tokens: () =>
        Promise.resolve({
          ok: false,
          status: 401,
          code: "unauthenticated",
          message: "Connexion requise.",
        }),
    });
    h.client.open();
    await h.flush();
    expect(h.sockets).toHaveLength(0);
    expect(h.actions.at(-1)).toMatchObject({ type: "failed", key: "signin" });
  });

  it("service non configuré (503) : message dédié", async () => {
    const h = harness({
      tokens: () =>
        Promise.resolve({
          ok: false,
          status: 503,
          code: "live_unavailable",
          message: "pas de clé",
        }),
    });
    h.client.open();
    await h.flush();
    expect(h.actions.at(-1)).toMatchObject({
      type: "failed",
      key: "unavailable",
    });
  });

  it("service injoignable : le socket ne s'ouvre jamais, l'attente est bornée", async () => {
    const h = harness();
    h.client.open();
    await h.flush();
    await h.advance(LIVE_UI.connectTimeoutMs + 1);
    expect(h.actions.at(-1)).toMatchObject({
      type: "failed",
      key: "unreachable",
    });
    expect(h.last.closedWith).not.toBeNull();
  });

  it("server_busy au départ : l'erreur du service est transmise telle quelle, sans boucle de reprise", async () => {
    const h = harness();
    h.client.open();
    await h.flush();
    h.last.open();
    h.last.say({
      type: "ERROR",
      seq: 0,
      code: "server_busy",
      message: "Le service est complet pour le moment.",
      recoverable: true,
      retry_after_s: 12,
    });
    h.last.drop(1013);
    await h.flush();
    await h.advance(60_000);
    expect(h.sockets).toHaveLength(1);
    const forwarded = h.actions.filter((a) => a.type === "server");
    expect(forwarded).toHaveLength(1);
    expect(h.kinds()).not.toContain("link_lost");
  });

  it("refus avant READY sans message (fermeture 1013) : 'service complet' plutôt qu'un silence", async () => {
    const h = harness();
    h.client.open();
    await h.flush();
    h.last.open();
    h.last.drop(1013);
    await h.flush();
    expect(h.actions.at(-1)).toMatchObject({
      type: "failed",
      key: "server_busy",
    });
  });
});

describe("coupure et reprise", () => {
  it("coupe le réseau : le son est gardé, un nouvel essai part toutes les 5 s avec un NOUVEAU jeton et la reprise", async () => {
    const h = await (async () => {
      const x = harness();
      await x.ready();
      return x;
    })();
    h.last.say({
      type: "CANDIDATES",
      seq: 4,
      count: 5,
      words_heard: 2,
      heard: null,
      items: [],
    });
    h.client.onAudio(h.block(1), 0.2);
    h.client.onAudio(h.block(2), 0.2);
    expect(h.last.audioSamples).toBe(3200);
    const first = h.last;
    first.drop();
    await h.flush();
    expect(h.kinds()).toContain("link_lost");
    h.client.onAudio(h.block(3), 0.2);
    expect(first.audioSamples).toBe(3200); // rien d'envoyé sur le socket mort
    await h.advance(LIVE_UI.retryEveryS * 1000);
    await h.flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.tokenCalls).toBe(2);
    h.last.open();
    expect(h.last.texts[0]).toMatchObject({
      type: "START",
      token: "jeton-2",
      resume: { session_id: "S1", last_seq: 4 },
    });
  });

  it("à la reprise, renvoie le son à partir de audio_received_samples, sans trou ni doublon", async () => {
    const h = harness();
    await h.ready();
    h.client.onAudio(h.block(1), 0.2); // 0..1600
    h.client.onAudio(h.block(2), 0.2); // 1600..3200
    h.last.drop();
    await h.flush();
    h.client.onAudio(h.block(3), 0.2); // 3200..4800, pendant la coupure
    await h.advance(LIVE_UI.retryEveryS * 1000);
    await h.flush();
    const second = h.last;
    second.open();
    // Le service dit avoir reçu 1600 échantillons seulement (le 2e bloc s'est perdu en route).
    second.say({
      type: "READY",
      seq: 0,
      session_id: "S1",
      resumed: true,
      last_seq: 0,
      audio_received_samples: 1600,
      degraded: [],
      technical: false,
      resume_ttl_s: 30,
    });
    await h.flush();
    const resent = second.audio.flatMap((b) => [...b]);
    expect(second.audioSamples).toBe(3200);
    expect(resent.slice(0, 3200).every((v) => v === 2)).toBe(true);
    expect(resent.slice(3200).every((v) => v === 3)).toBe(true);
    const back = h.actions.find((a) => a.type === "link_back");
    expect(back).toMatchObject({ type: "link_back" });
    expect((back as { catchupS: number }).catchupS).toBeCloseTo(3200 / 16000);
    await h.advance(1000);
    expect(h.kinds()).toContain("caught_up");
    // Le son qui arrive ensuite continue sans trou.
    h.client.onAudio(h.block(4), 0.2);
    expect(second.audioSamples).toBe(4800);
  });

  it("si le tampon a trop vieilli, le trou est comblé de silence pour garder le flux continu (et annoncé)", async () => {
    const h = harness();
    await h.ready();
    const maxBlocks = (LIVE_UI.bufferMaxS * LIVE_UI.sampleRate) / 1600;
    h.client.onAudio(h.block(1), 0.2);
    h.last.drop();
    await h.flush();
    for (let i = 0; i < maxBlocks + 5; i += 1)
      h.client.onAudio(h.block(7), 0.2);
    await h.advance(LIVE_UI.retryEveryS * 1000);
    await h.flush();
    h.last.open();
    h.last.say({
      type: "READY",
      seq: 0,
      session_id: "S1",
      resumed: true,
      last_seq: 0,
      audio_received_samples: 1600,
      degraded: [],
      technical: false,
      resume_ttl_s: 30,
    });
    await h.flush();
    const total = (maxBlocks + 6) * 1600;
    expect(h.last.audioSamples + 1600).toBe(total);
    expect(h.client.lostAudioSamples).toBeGreaterThan(0);
    const first = h.last.audio[0];
    expect(first.every((v) => v === 0)).toBe(true);
  });

  it("abandonne après le délai de reprise + marge : fin locale 'session expirée', le micro n'est pas relancé", async () => {
    const h = harness();
    await h.ready({ resume_ttl_s: 20 });
    h.last.drop();
    await h.flush();
    // Le réseau reste mort : chaque nouvel essai échoue.
    for (let i = 0; i < 20; i += 1) {
      await h.advance(LIVE_UI.retryEveryS * 1000);
      await h.flush();
      const s = h.last;
      if (s.readyState === 0) s.drop();
    }
    const finish = h.actions.find((a) => a.type === "finish");
    expect(finish).toMatchObject({ type: "finish", error: { key: "expired" } });
    const sockets = h.sockets.length;
    await h.advance(60_000);
    expect(h.sockets.length).toBe(sockets);
  });

  it("session_expired à la reprise (ERROR puis FINAL) : l'erreur et la fin sont transmises, pas de nouvel essai", async () => {
    const h = harness();
    await h.ready();
    h.last.drop();
    await h.advance(LIVE_UI.retryEveryS * 1000);
    await h.flush();
    h.last.open();
    h.last.say({
      type: "ERROR",
      seq: 0,
      code: "session_expired",
      message: "La session a expiré.",
      recoverable: true,
    });
    h.last.say({ type: "FINAL", seq: 9, t: 8, document: {} });
    await h.flush();
    const types = h.actions
      .filter((a) => a.type === "server")
      .map((a) => (a as { message: { type: string } }).message.type);
    expect(types.slice(1)).toEqual(["ERROR", "FINAL"]);
    const count = h.sockets.length;
    await h.advance(30_000);
    expect(h.sockets.length).toBe(count);
  });

  it("idle_timeout (recoverable) est traité comme une coupure reprenable", async () => {
    const h = harness();
    await h.ready();
    h.last.say({
      type: "ERROR",
      seq: 0,
      code: "idle_timeout",
      message: "Aucun son reçu.",
      recoverable: true,
    });
    h.last.drop(1000);
    await h.flush();
    expect(h.kinds()).toContain("link_lost");
    expect(h.actions.filter((a) => a.type === "server")).toHaveLength(1); // READY seulement, jamais l’ERROR
  });

  it("un jeton qui échoue pendant une coupure ne tue pas l'écoute : on réessaie", async () => {
    let calls = 0;
    const h = harness({
      tokens: () => {
        calls += 1;
        return Promise.resolve(
          calls === 2
            ? {
                ok: false as const,
                status: 0,
                code: "network",
                message: "hors ligne",
              }
            : {
                ok: true as const,
                token: `t${calls}`,
                url: "ws://127.0.0.1:8765/live",
                technical: false,
              },
        );
      },
    });
    await h.ready();
    h.last.drop();
    await h.advance(LIVE_UI.retryEveryS * 1000);
    await h.flush();
    expect(h.sockets).toHaveLength(1); // 2e essai : pas de jeton
    await h.advance(LIVE_UI.retryEveryS * 1000);
    await h.flush();
    expect(h.sockets).toHaveLength(2);
    expect(h.actions.some((a) => a.type === "finish")).toBe(false);
  });
});

describe("pause, arrêt, fermeture", () => {
  it("en pause rien du micro n'est envoyé ; une trame de silence très courte maintient la connexion", async () => {
    const h = harness();
    const socket = await h.ready();
    h.client.pause();
    h.client.onAudio(h.block(9), 0.9);
    expect(socket.audio).toEqual([]);
    await h.advance(LIVE_UI.heartbeatEveryMs * 3 + 10);
    expect(socket.audio).toHaveLength(3);
    for (const frame of socket.audio) {
      expect(frame.every((v) => v === 0)).toBe(true);
      expect(frame.byteLength).toBe(
        ((LIVE_UI.heartbeatMs * LIVE_UI.sampleRate) / 1000) * 2,
      );
    }
    h.client.resume();
    h.client.onAudio(h.block(5), 0.3);
    expect(socket.audio.at(-1)?.[0]).toBe(5);
    await h.advance(LIVE_UI.heartbeatEveryMs * 3);
    expect(socket.audio.filter((b) => b.every((v) => v === 0))).toHaveLength(3);
  });

  it("arrêter envoie END, attend FINAL, ferme proprement (1000) et libère les minuteries", async () => {
    const h = harness();
    const socket = await h.ready();
    h.client.onAudio(h.block(1), 0.2);
    h.client.stop();
    expect(socket.texts.at(-1)).toEqual({ type: "END" });
    socket.say({ type: "FINALIZING", seq: 3, pending_s: null });
    socket.say({ type: "FINAL", seq: 4, t: 1, document: {} });
    await h.flush();
    expect(socket.closedWith).toBe(1000);
    expect(h.actions.filter((a) => a.type === "server")).toHaveLength(3);
    const before = h.actions.length;
    h.client.onAudio(h.block(1), 0.2);
    await h.advance(120_000);
    expect(socket.audio).toHaveLength(1);
    expect(h.actions.length).toBe(before);
  });

  it("si FINAL ne vient pas, la fin est locale et le dit (pas de fausse fin du service)", async () => {
    const h = harness();
    await h.ready();
    h.client.stop();
    await h.advance(LIVE_UI.finalTimeoutMs + 1);
    expect(h.actions.at(-1)).toMatchObject({ type: "finish" });
    expect(
      h.actions.some(
        (a) =>
          a.type === "server" &&
          (a as { message: { type: string } }).message.type === "FINAL",
      ),
    ).toBe(false);
  });

  it("arrêter pendant une coupure : reprend d'abord, envoie END après le renvoi du son", async () => {
    const h = harness();
    await h.ready();
    h.client.onAudio(h.block(1), 0.2);
    h.last.drop();
    await h.flush();
    h.client.stop();
    await h.advance(LIVE_UI.retryEveryS * 1000);
    await h.flush();
    const second = h.last;
    second.open();
    second.say({
      type: "READY",
      seq: 0,
      session_id: "S1",
      resumed: true,
      last_seq: 0,
      audio_received_samples: 0,
      degraded: [],
      technical: false,
      resume_ttl_s: 30,
    });
    await h.flush();
    expect(second.audioSamples).toBe(1600);
    expect(second.texts.at(-1)).toEqual({ type: "END" });
  });

  it("dispose ferme le socket (1000) sans rien envoyer d'autre : page quittée", async () => {
    const h = harness();
    const socket = await h.ready();
    h.client.dispose();
    expect(socket.closedWith).toBe(1000);
    await h.advance(120_000);
    expect(h.sockets).toHaveLength(1);
  });

  it("contre-pression : n'envoie pas plus vite que le socket ne vide", async () => {
    const h = harness();
    const socket = await h.ready();
    socket.bufferedAmount = 10_000_000;
    for (let i = 0; i < 5; i += 1) h.client.onAudio(h.block(i + 1), 0.2);
    expect(socket.audio).toEqual([]);
    socket.bufferedAmount = 0;
    await h.advance(200);
    expect(socket.audio).toHaveLength(5);
  });
});

describe("messages du service", () => {
  it("transmet les messages valides, ignore les illisibles et les types inconnus", async () => {
    const h = harness();
    const socket = await h.ready();
    socket.onmessage?.({ data: "pas du json" });
    socket.say({ type: "SURPRISE", seq: 1 });
    socket.say({ type: "PROGRESS", seq: 2, ref: "1:2" }); // mal formé
    socket.say({ type: "LOST", seq: 3, reason: "silence" });
    await h.flush();
    const types = h.actions
      .filter((a) => a.type === "server")
      .map((a) => (a as { message: { type: string } }).message.type);
    expect(types).toEqual(["READY", "LOST"]);
  });

  it("le niveau et la durée captée sont envoyés à l'interface, au plus 8 fois par seconde", async () => {
    const h = harness();
    await h.ready();
    for (let i = 0; i < 20; i += 1) {
      h.client.onAudio(h.block(1, 1600), 0.1 + i / 100);
      await h.advance(50);
    }
    const audio = h.actions.filter((a) => a.type === "audio") as Extract<
      LiveAction,
      { type: "audio" }
    >[];
    expect(audio.length).toBeGreaterThanOrEqual(5);
    expect(audio.length).toBeLessThanOrEqual(10);
    expect(audio.at(-1)?.capturedS).toBeCloseTo(
      audio.length ? (20 * 1600) / 16000 : 0,
      0,
    );
  });
});
