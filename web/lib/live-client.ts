/**
 * Le client du flux `aqr.live/1` : jeton → WebSocket → `START` → audio par blocs → `END`, avec reprise
 * après coupure (docs/LIVE-PROTOCOL.md §6). Aucune dépendance au navigateur : le réseau, l'horloge et
 * les minuteries sont injectés (`LiveDeps`), si bien que tout le comportement se teste avec un faux
 * serveur et une fausse horloge.
 *
 * Règles tenues ici :
 *  - aucun son ne part avant `READY` (le son capté entre-temps est gardé, puis envoyé dans l'ordre) ;
 *  - le son envoyé et à envoyer vit dans un tampon borné (`LIVE_UI.bufferMaxS`) ; après une coupure, il
 *    est renvoyé à partir de `audio_received_samples`, sans trou ni doublon ; si le tampon a trop
 *    vieilli, le trou est comblé de silence (le flux reste continu) et compté, jamais caché ;
 *  - une reprise utilise un NOUVEAU jeton (un jeton ne sert qu'une fois) ;
 *  - en pause, rien du micro ne part : seule une trame de silence très courte maintient la connexion ;
 *  - un message illisible ou d'un type inconnu est écarté, jamais deviné.
 */
import { LIVE_UI } from "./live-config";
import { classifyError, serviceErrorKey } from "./live-errors";
import {
  LIVE_SCHEMA,
  parseServerMessage,
  type MessageOf,
} from "./live-protocol";
import { PcmBuffer, silenceBytes } from "./live-pcm";
import type { LiveAction } from "./live-store";

export interface SocketLike {
  readyState: number;
  bufferedAmount: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export type TokenResult =
  | { ok: true; token: string; url: string; technical: boolean }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      retryAfterS?: number;
    };

export type LiveDeps = {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  openSocket: (url: string) => SocketLike;
  fetchToken: (technical: boolean) => Promise<TokenResult>;
  dispatch: (action: LiveAction) => void;
  options: { translation: string; technical: boolean };
};

type Mode = "idle" | "connecting" | "streaming" | "lost" | "done";
type TimerName = "connect" | "retry" | "heartbeat" | "pump" | "final";

/** Au-delà, on attend que le navigateur vide son tampon d'envoi avant d'envoyer la suite. */
const HIGH_WATER_BYTES = 256 * 1024;
const PUMP_RETRY_MS = 20;
const OPEN = 1;

export class LiveClient {
  private mode: Mode = "idle";
  private socket: SocketLike | null = null;
  private generation = 0;
  private attempting = false;
  private everReady = false;
  private connReady = false;
  private startErrorForwarded = false;
  private terminalPending = false;
  private sessionId: string | null = null;
  private lastSeq = 0;
  private resumeTtlS = 30;
  private lostAtMs: number | null = null;
  private paused = false;
  private endRequested = false;
  private endSent = false;
  private catchingUp = false;
  private captured = 0;
  private readonly buffer = new PcmBuffer(
    LIVE_UI.bufferMaxS * LIVE_UI.sampleRate,
  );
  private sent = 0;
  private lostAudio = 0;
  private uiAt = 0;
  private uiLevel = 0;
  private timers: Record<TimerName, unknown> = {
    connect: null,
    retry: null,
    heartbeat: null,
    pump: null,
    final: null,
  };

  constructor(private readonly deps: LiveDeps) {}

  /** Échantillons que le tampon n'a plus pu renvoyer après une coupure trop longue (comblés de silence). */
  get lostAudioSamples(): number {
    return this.lostAudio;
  }

  // ───────────── API ─────────────

  /** Commence : le micro est déjà ouvert, les blocs arrivent par `onAudio`. */
  open(): void {
    if (this.mode !== "idle") return;
    this.mode = "connecting";
    void this.attempt(false);
  }

  /** Un bloc PCM 16 kHz mono (octets s16le) et son niveau (0–1). */
  onAudio(bytes: Uint8Array, level: number): void {
    if (this.mode === "idle" || this.mode === "done") return;
    if (this.paused || this.endRequested) return;
    this.captured += bytes.length / 2;
    this.buffer.append(bytes);
    this.uiLevel = Math.max(this.uiLevel, level);
    const now = this.deps.now();
    if (now - this.uiAt >= 1000 / LIVE_UI.levelHz) {
      this.uiAt = now;
      this.deps.dispatch({
        type: "audio",
        nowMs: now,
        capturedS: this.captured / LIVE_UI.sampleRate,
        level: this.uiLevel,
      });
      this.uiLevel = 0;
    }
    this.pump();
  }

  pause(): void {
    if (this.paused || this.mode === "done") return;
    this.paused = true;
    this.beat();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.clear("heartbeat");
  }

  /** Fin d'écoute : `END` dès que tout le son gardé est parti ; `FINAL` attendu ensuite. */
  stop(): void {
    if (this.endRequested || this.mode === "done" || this.mode === "idle")
      return;
    this.endRequested = true;
    this.paused = false;
    this.clear("heartbeat");
    if (this.mode === "lost") {
      this.clear("retry");
      this.timers.retry = this.deps.setTimer(() => void this.attempt(true), 0);
    }
    this.pump();
  }

  /** « Réessayer maintenant » pendant une coupure : sans attendre le prochain essai automatique. */
  retryNow(): void {
    if (this.mode !== "lost" || this.attempting || this.socket) return;
    this.clear("retry");
    void this.attempt(true);
  }

  /** Page quittée : fermeture propre (le service termine le flux et rend sa place). */
  dispose(): void {
    this.generation += 1;
    this.mode = "done";
    this.clearAll();
    this.detach(1000);
  }

  // ───────────── Connexion ─────────────

  private async attempt(resume: boolean): Promise<void> {
    this.attempting = true;
    try {
      await this.connect(resume);
    } finally {
      this.attempting = false;
    }
  }

  private async connect(resume: boolean): Promise<void> {
    const generation = (this.generation += 1);
    const token = await this.deps.fetchToken(this.deps.options.technical);
    if (generation !== this.generation || this.mode === "done") return;
    if (!token.ok) {
      if (!resume) {
        this.fail(
          token.status === 429
            ? "rate_limited"
            : token.status === 0
              ? "unreachable"
              : serviceErrorKey(token.code),
          undefined,
          token.retryAfterS,
        );
        return;
      }
      if (
        token.code === "unauthenticated" ||
        token.code === "live_unavailable"
      ) {
        this.expire(serviceErrorKey(token.code));
        return;
      }
      this.scheduleRetry();
      return;
    }
    const socket = this.deps.openSocket(token.url);
    this.socket = socket;
    this.connReady = false;
    this.timers.connect = this.deps.setTimer(() => {
      if (this.socket === socket) {
        this.detach(1000);
        this.handleDown();
      }
    }, LIVE_UI.connectTimeoutMs);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.clear("connect");
      socket.send(
        JSON.stringify({
          type: "START",
          schema: LIVE_SCHEMA,
          token: token.token,
          audio: {
            encoding: "pcm_s16le",
            sample_rate: LIVE_UI.sampleRate,
            channels: 1,
          },
          options: {
            translation: this.deps.options.translation,
            technical: this.deps.options.technical,
          },
          ...(resume && this.sessionId
            ? {
                resume: {
                  session_id: this.sessionId,
                  last_seq: this.lastSeq,
                },
              }
            : {}),
        }),
      );
    };
    socket.onmessage = (event) => {
      if (this.socket === socket) this.onMessage(event.data, resume);
    };
    socket.onclose = (event) => {
      if (this.socket === socket) this.down(socket, event.code);
    };
    socket.onerror = () => {
      if (this.socket === socket) this.down(socket);
    };
  }

  private onMessage(raw: unknown, resuming: boolean): void {
    const parsed = parseServerMessage(raw);
    if (!parsed.ok) return;
    const message = parsed.message;
    if (message.seq > this.lastSeq) this.lastSeq = message.seq;
    if (message.type === "READY") {
      this.clear("connect");
      this.connReady = true;
      this.everReady = true;
      this.mode = "streaming";
      this.sessionId = message.session_id;
      this.resumeTtlS = message.resume_ttl_s;
      this.deps.dispatch({
        type: "server",
        nowMs: this.deps.now(),
        message,
      });
      if (resuming || message.resumed) {
        const received = Math.min(
          message.audio_received_samples,
          this.buffer.totalSamples,
        );
        this.sent = received;
        this.lostAudio += Math.max(0, this.buffer.startSample - received);
        this.lostAtMs = null;
        this.catchingUp = this.buffer.totalSamples > received;
        this.deps.dispatch({
          type: "link_back",
          nowMs: this.deps.now(),
          catchupS: (this.buffer.totalSamples - received) / LIVE_UI.sampleRate,
        });
      } else {
        this.sent = Math.min(message.audio_received_samples, this.sent);
      }
      this.pump();
      return;
    }
    if (message.type === "ERROR") {
      this.onServiceError(message);
      return;
    }
    this.deps.dispatch({ type: "server", nowMs: this.deps.now(), message });
    if (message.type === "FINAL") this.complete();
  }

  private onServiceError(message: MessageOf<"ERROR">): void {
    const code = message.code;
    let action = classifyError(code, this.everReady);
    // Pendant une reprise, avant READY : seuls ces deux codes closent la session ; le reste se retente.
    if (this.everReady && !this.connReady)
      action =
        code === "session_expired" || code === "replay_unavailable"
          ? "terminal"
          : "retry_link";
    if (action === "start_failure") {
      this.startErrorForwarded = true;
      this.deps.dispatch({
        type: "server",
        nowMs: this.deps.now(),
        message,
      });
      this.mode = "done";
      this.clearAll();
      this.detach(1000);
      return;
    }
    if (action === "terminal") {
      this.terminalPending = true;
      this.deps.dispatch({
        type: "server",
        nowMs: this.deps.now(),
        message,
      });
      this.clear("final");
      this.timers.final = this.deps.setTimer(
        () => this.finishLocal(serviceErrorKey(code), message.message),
        LIVE_UI.finalTimeoutMs,
      );
      return;
    }
    // retry_link : le service ferme, la coupure suit (elle rouvre un flux repris avec un nouveau jeton).
    this.detach(1000);
    this.handleDown();
  }

  /** Le socket est tombé (ou n'a jamais répondu). */
  private down(socket: SocketLike, code?: number): void {
    if (this.socket !== socket) return;
    this.socket = null;
    this.handleDown(code);
  }

  private handleDown(code?: number): void {
    if (this.mode === "done") return;
    this.clear("connect");
    this.connReady = false;
    if (!this.everReady) {
      if (this.startErrorForwarded) return;
      this.fail(code === 1013 ? "server_busy" : "unreachable");
      return;
    }
    if (this.terminalPending) {
      this.finishLocal("internal");
      return;
    }
    if (this.mode !== "lost") {
      this.mode = "lost";
      this.lostAtMs = this.deps.now();
      this.deps.dispatch({ type: "link_lost", nowMs: this.lostAtMs });
    }
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    this.clear("retry");
    if (this.mode === "done") return;
    const lostAt = this.lostAtMs ?? this.deps.now();
    const deadline = lostAt + (this.resumeTtlS + LIVE_UI.resumeGraceS) * 1000;
    if (this.deps.now() >= deadline) {
      this.expire("expired");
      return;
    }
    this.timers.retry = this.deps.setTimer(
      () => void this.attempt(true),
      LIVE_UI.retryEveryS * 1000,
    );
  }

  // ───────────── Envoi ─────────────

  private pump(): void {
    const socket = this.socket;
    if (this.mode !== "streaming" || !socket || socket.readyState !== OPEN)
      return;
    this.clear("pump");
    // Un trou que le tampon ne peut plus remplir : du silence, pour que le flux reste continu.
    while (this.sent < this.buffer.startSample) {
      if (socket.bufferedAmount > HIGH_WATER_BYTES) return this.later();
      const n = Math.min(
        this.buffer.startSample - this.sent,
        (LIVE_UI.blockMs * LIVE_UI.sampleRate) / 1000,
      );
      socket.send(silenceBytes(n));
      this.sent += n;
    }
    const { blocks } = this.buffer.from(this.sent);
    for (const block of blocks) {
      if (socket.bufferedAmount > HIGH_WATER_BYTES) return this.later();
      socket.send(block);
      this.sent += block.length / 2;
    }
    if (this.catchingUp) {
      this.catchingUp = false;
      this.deps.dispatch({ type: "caught_up", nowMs: this.deps.now() });
    }
    if (this.endRequested && !this.endSent) {
      this.endSent = true;
      socket.send(JSON.stringify({ type: "END" }));
      this.clear("final");
      this.timers.final = this.deps.setTimer(
        () => this.finishLocal(null),
        LIVE_UI.finalTimeoutMs,
      );
    }
  }

  private later(): void {
    this.clear("pump");
    this.timers.pump = this.deps.setTimer(() => this.pump(), PUMP_RETRY_MS);
  }

  private beat(): void {
    this.clear("heartbeat");
    if (!this.paused || this.mode === "done") return;
    this.timers.heartbeat = this.deps.setTimer(() => {
      if (!this.paused || this.mode === "done") return;
      this.buffer.append(
        silenceBytes((LIVE_UI.heartbeatMs * LIVE_UI.sampleRate) / 1000),
      );
      this.pump();
      this.beat();
    }, LIVE_UI.heartbeatEveryMs);
  }

  // ───────────── Fins ─────────────

  private complete(): void {
    this.mode = "done";
    this.clearAll();
    this.detach(1000);
  }

  /** Fin décidée ici (pas de `FINAL` du service) : elle le dit, ce qui avait été entendu reste. */
  private finishLocal(
    key: ReturnType<typeof serviceErrorKey> | null,
    message?: string,
  ) {
    if (this.mode === "done") return;
    this.mode = "done";
    this.clearAll();
    this.detach(1000);
    this.deps.dispatch({
      type: "finish",
      nowMs: this.deps.now(),
      error: key ? { key, message: message ?? "" } : undefined,
    });
  }

  private expire(key: ReturnType<typeof serviceErrorKey>): void {
    this.finishLocal(key);
  }

  private fail(
    key: ReturnType<typeof serviceErrorKey>,
    message?: string,
    retryAfterS?: number,
  ): void {
    this.mode = "done";
    this.clearAll();
    this.detach(1000);
    this.deps.dispatch({
      type: "failed",
      nowMs: this.deps.now(),
      key,
      message,
      retryAfterS,
    });
  }

  private detach(code: number): void {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close(code);
    } catch {
      // déjà fermé
    }
  }

  private clear(name: TimerName): void {
    const handle = this.timers[name];
    if (handle !== null) this.deps.clearTimer(handle);
    this.timers[name] = null;
  }

  private clearAll(): void {
    for (const name of Object.keys(this.timers) as TimerName[])
      this.clear(name);
  }
}
