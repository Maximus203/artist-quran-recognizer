import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, type Readable } from "node:stream";

/**
 * Worker Python chaud : `aqr worker` garde le moteur chargé entre deux analyses (le chargement des
 * modèles prend environ 50 s). Chaque analyse envoie une requête JSON (une ligne) et reçoit une
 * réponse JSON (une ligne) : `{ id, code, stdout, stderr }`. Les arguments sont ceux de la ligne de
 * commande habituelle : le même `main` Python, rien n'est dupliqué.
 *
 * Une analyse est présentée comme un processus (`JobProcess`) : `jobs.ts` n'a pas à savoir si le
 * moteur est chaud. `kill()` tue le worker (modèles perdus) : le job suivant en lance un neuf.
 */
export interface JobProcess {
  pid?: number;
  stdout: Readable | null;
  stderr: Readable | null;
  kill(): boolean;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
}

const STDERR_TAIL = 8000;

type Reply = {
  id?: unknown;
  code?: unknown;
  stdout?: unknown;
  stderr?: unknown;
};

class WarmRun extends EventEmitter implements JobProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid?: number;
  #finished = false;
  readonly #stop: () => void;

  constructor(stop: () => void) {
    super();
    this.#stop = stop;
  }

  kill(): boolean {
    if (this.#finished) return false;
    this.#stop();
    return true;
  }

  get finished(): boolean {
    return this.#finished;
  }

  /** Écrit les sorties, les ferme, puis annonce `close` (comme un vrai processus : sorties d'abord). */
  finish(code: number | null, stdout: string, stderr: string): void {
    if (this.#finished) return;
    this.#finished = true;
    const ended = (stream: PassThrough) =>
      new Promise<void>((resolve) => {
        stream.once("end", resolve);
        // Personne n'écoute : on vide le flux pour que `end` arrive quand même.
        if (stream.listenerCount("data") === 0) stream.resume();
      });
    const done = Promise.all([ended(this.stdout), ended(this.stderr)]);
    if (stdout) this.stdout.write(stdout);
    if (stderr) this.stderr.write(stderr);
    this.stdout.end();
    this.stderr.end();
    void done.then(() => this.emit("close", code));
  }

  fail(error: Error): void {
    if (!this.#finished && this.listenerCount("error") > 0)
      this.emit("error", error);
  }
}

class Worker {
  readonly process: ChildProcessWithoutNullStreams;
  current: { id: string; run: WarmRun } | null = null;
  dead = false;
  #buffer = "";
  #stderr = "";

  constructor(
    process: ChildProcessWithoutNullStreams,
    private readonly onReply: (worker: Worker) => void,
    private readonly onDead: (worker: Worker) => void,
  ) {
    this.process = process;
    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");
    process.stdout.on("data", (chunk: string) => this.#read(chunk));
    process.stderr.on("data", (chunk: string) => {
      this.#stderr = (this.#stderr + chunk).slice(-STDERR_TAIL);
    });
    process.stdin.on("error", () => undefined); // EPIPE : le `close` du processus dira le reste
    process.on("error", (error) => {
      this.#stderr = error.message;
      this.current?.run.fail(error);
    });
    process.on("close", (code) => this.#closed(code));
  }

  #read(chunk: string): void {
    this.#buffer += chunk;
    let index: number;
    while ((index = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, index).trim();
      this.#buffer = this.#buffer.slice(index + 1);
      if (!line) continue;
      let reply: Reply;
      try {
        reply = JSON.parse(line) as Reply;
      } catch {
        continue; // pas du protocole : ignoré
      }
      const current = this.current;
      if (!current || reply.id !== current.id) continue; // « ready », ou réponse d'une requête abandonnée
      this.current = null;
      current.run.finish(
        typeof reply.code === "number" ? reply.code : 1,
        typeof reply.stdout === "string" ? reply.stdout : "",
        typeof reply.stderr === "string" ? reply.stderr : "",
      );
      this.onReply(this);
    }
  }

  #closed(code: number | null): void {
    this.dead = true;
    const current = this.current;
    this.current = null;
    this.onDead(this);
    if (!current) return;
    const detail = this.#stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    current.run.finish(
      code ?? 1,
      "",
      `Le moteur s’est arrêté pendant l’analyse (worker, code ${code ?? "inconnu"}).${detail ? ` ${detail}` : ""}`,
    );
  }
}

export type WarmWorkerOptions = {
  spawnWorker: () => ChildProcessWithoutNullStreams;
  /** Workers gardés au repos (modèles en mémoire) ; les autres s'arrêtent à la fin de leur job. */
  maxIdle: () => number;
};

export class WarmWorkerPool {
  readonly #options: WarmWorkerOptions;
  readonly #idle: Worker[] = [];
  readonly #all = new Set<Worker>();
  #sequence = 0;

  constructor(options: WarmWorkerOptions) {
    this.#options = options;
  }

  idleCount(): number {
    return this.#idle.length;
  }

  /** Envoie une analyse (arguments de `aqr`, sans `-m aqr.cli`) à un worker libre ou neuf. */
  start(argv: string[]): JobProcess {
    let worker = this.#idle.pop();
    if (!worker) {
      worker = new Worker(
        this.#options.spawnWorker(),
        (done) => this.#release(done),
        (dead) => this.#forget(dead),
      );
      this.#all.add(worker);
    }
    const target = worker;
    const run = new WarmRun(() => target.process.kill());
    run.pid = target.process.pid;
    const id = String(++this.#sequence);
    target.current = { id, run };
    target.process.stdin.write(`${JSON.stringify({ id, argv })}\n`);
    return run;
  }

  #release(worker: Worker): void {
    if (worker.dead) return;
    if (this.#idle.length < Math.max(0, this.#options.maxIdle())) {
      this.#idle.push(worker);
      return;
    }
    worker.process.stdin.end(); // fin d'entrée : le worker s'arrête proprement
    this.#all.delete(worker);
  }

  #forget(worker: Worker): void {
    this.#all.delete(worker);
    const index = this.#idle.indexOf(worker);
    if (index >= 0) this.#idle.splice(index, 1);
  }

  /** Arrête tous les workers (tests, arrêt du serveur). */
  shutdown(): void {
    for (const worker of [...this.#all]) worker.process.kill();
    this.#idle.length = 0;
  }
}
