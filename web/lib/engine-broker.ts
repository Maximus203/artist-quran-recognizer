import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "./db";
import { listAgents, preferredAgentAvailable } from "./engine-agents";
import { parseRecognition } from "./recognition";
import { WarmRun, type JobProcess } from "./warm-worker";

/**
 * Courtier du moteur distant (ADR-0017). Une analyse « offerte » attend qu'un agent la réclame ; réclamée,
 * elle est prêtée (bail à durée limitée) à CET agent seul. Le courtier présente chaque analyse comme un
 * processus (`JobProcess`) : la file, le délai de garde, l'annulation et le traitement du résultat de
 * `jobs.ts` ne changent pas. État en mémoire : un redémarrage de l'atelier perd les baux, l'agent reçoit
 * « bail inconnu » et la reprise de file existante remet la session en attente.
 */
export const RESULT_FILE = "source.recognition.json";
/** Taille maximale d'un résultat déposé (le contrat de sortie d'un long enregistrement tient en quelques Mio). */
export const MAX_RESULT_BYTES = 50 * 1024 * 1024;
const DEFAULT_LEASE_S = 90;
const INTERRUPTED = "interrompue\n";

export function leaseSeconds(
  raw: string | undefined = process.env.AQR_ENGINE_LEASE_S,
): number {
  const value = Number(raw);
  return Number.isInteger(value) && value >= 10 && value <= 3600
    ? value
    : DEFAULT_LEASE_S;
}

export type Ticket = {
  /** Identifiant de la session. */
  id: string;
  asr: string;
  audioFile: string;
  audioSha256: string;
  audioSize: number;
  outDir: string;
};

export type Lease = {
  id: string;
  agentId: number;
  ticket: Ticket;
  expiresAt: number;
  cancelled: boolean;
  startedAt: number;
};

type Held = Lease & { run: WarmRun };
type Offer = { ticket: Ticket; run: WarmRun };
type Waiter = {
  agentId: number;
  resolve: (lease: Lease | null) => void;
  timer: NodeJS.Timeout;
};

/**
 * Règle de priorité entre agents : « cet agent a-t-il le droit de prendre une analyse maintenant ? ». Fournie par
 * l'appelant (elle lit les agents en base) ; sans règle, le premier qui appelle prend l'analyse.
 */
export type ClaimPolicy = (
  agentId: number,
  context: { busy: (agentId: number) => boolean; now: number },
) => boolean;

export class EngineBroker {
  readonly #offers: Offer[] = [];
  readonly #mayClaim: ClaimPolicy | undefined;
  readonly #agentName: ((agentId: number) => string | null) | undefined;

  constructor(
    options: {
      mayClaim?: ClaimPolicy;
      /** Nom lisible d'un agent, pour dire sur la session qui l'a analysée. */
      agentName?: (agentId: number) => string | null;
    } = {},
  ) {
    this.#mayClaim = options.mayClaim;
    this.#agentName = options.agentName;
  }

  /** Cet agent tient-il un bail en cours ? */
  isBusy(agentId: number): boolean {
    for (const lease of this.#leases.values())
      if (lease.agentId === agentId && !lease.cancelled) return true;
    return false;
  }

  readonly #leases = new Map<string, Held>();
  readonly #waiters: Waiter[] = [];
  #reaper: NodeJS.Timeout | undefined;

  /** Met une analyse en attente d'un agent ; rend le « processus » que `jobs.ts` suit. */
  offer(ticket: Ticket): JobProcess {
    const run: WarmRun = new WarmRun(() => this.#cancel(ticket.id));
    this.#offers.push({ ticket, run });
    this.#startReaper();
    this.#dispatch();
    return run;
  }

  /** Réclame la plus ancienne analyse en attente, ou null. Un agent ne tient qu'un bail à la fois. */
  claim(agentId: number, now = Date.now()): Lease | null {
    if (this.isBusy(agentId)) return null;
    // Premier choix / secours : le secours attend tant qu'un agent préféré est en ligne et disponible.
    if (
      this.#mayClaim &&
      this.#offers.length > 0 &&
      !this.#mayClaim(agentId, { busy: (id) => this.isBusy(id), now })
    )
      return null;
    const offer = this.#offers.shift();
    if (!offer) return null;
    const lease = {
      id: randomBytes(16).toString("hex"),
      agentId,
      ticket: offer.ticket,
      expiresAt: now + leaseSeconds() * 1000,
      cancelled: false,
      startedAt: now,
      run: offer.run,
    };
    this.#leases.set(lease.id, lease);
    offer.run.agentName = this.#agentName?.(agentId) ?? `agent n°${agentId}`;
    offer.run.stderr.write(`moteur distant : analyse prise en charge\n`);
    return lease;
  }

  /** Comme `claim`, mais attend jusqu'à `waitMs` qu'une analyse arrive (long polling). */
  claimWait(
    agentId: number,
    waitMs: number,
    signal?: AbortSignal,
  ): Promise<Lease | null> {
    const now = this.claim(agentId);
    if (now || waitMs <= 0) return Promise.resolve(now);
    return new Promise((resolve) => {
      const waiter: Waiter = {
        agentId,
        resolve,
        timer: setTimeout(() => this.#drop(waiter, null), waitMs),
      };
      waiter.timer.unref?.();
      signal?.addEventListener("abort", () => this.#drop(waiter, null), {
        once: true,
      });
      this.#waiters.push(waiter);
    });
  }

  #drop(waiter: Waiter, lease: Lease | null): void {
    clearTimeout(waiter.timer);
    const index = this.#waiters.indexOf(waiter);
    if (index >= 0) this.#waiters.splice(index, 1);
    waiter.resolve(lease);
  }

  #dispatch(now = Date.now()): void {
    for (const waiter of [...this.#waiters]) {
      if (this.#offers.length === 0) return;
      const lease = this.claim(waiter.agentId, now);
      if (lease) this.#drop(waiter, lease);
    }
  }

  /** Le bail `id` s'il appartient à CET agent, est connu et n'est pas expiré ; sinon null (jamais d'indice). */
  lease(id: string, agentId: number): Lease | null {
    return this.#held(id, agentId);
  }

  #held(id: string, agentId: number): Held | null {
    const lease = this.#leases.get(id);
    return lease && lease.agentId === agentId ? lease : null;
  }

  /** Prolonge le bail ; rend `cancel` si l'utilisateur a annulé l'analyse. */
  heartbeat(
    id: string,
    agentId: number,
    now = Date.now(),
  ): { cancel: boolean } | null {
    const lease = this.lease(id, agentId);
    if (!lease) return null;
    if (lease.cancelled) return { cancel: true };
    lease.expiresAt = now + leaseSeconds() * 1000;
    return { cancel: false };
  }

  /** Dépose le résultat : contrat de sortie vérifié, empreinte de l'audio comparée, un seul fichier écrit. */
  async complete(id: string, agentId: number, raw: Buffer): Promise<void> {
    const lease = this.#leases.get(id);
    if (!lease || lease.agentId !== agentId) throw new UnknownLeaseError();
    if (lease.cancelled) throw new UnknownLeaseError();
    const parsed = parseRecognition(JSON.parse(raw.toString("utf8")));
    if (parsed.source.sha256.toLowerCase() !== lease.ticket.audioSha256)
      throw new Error("Empreinte de l'audio incohérente avec l'analyse");
    await mkdir(lease.ticket.outDir, { recursive: true });
    const target = path.join(lease.ticket.outDir, RESULT_FILE);
    const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    await writeFile(temp, raw);
    await rename(temp, target);
    this.#leases.delete(id);
    lease.run.finish(0, "", "");
  }

  /** Échec annoncé par l'agent : son message (borné) devient la raison affichée. */
  fail(id: string, agentId: number, message: string): boolean {
    const lease = this.#held(id, agentId);
    if (!lease) return false;
    this.#leases.delete(id);
    lease.run.finish(1, "", `${message.replace(/\s+/g, " ").slice(0, 300)}\n`);
    return true;
  }

  /** Annulation demandée par `jobs.ts` (kill) : attente retirée, ou bail marqué (l'agent le saura au signal de vie). */
  #cancel(sessionId: string): void {
    const waiting = this.#offers.findIndex((o) => o.ticket.id === sessionId);
    if (waiting >= 0) {
      const [offer] = this.#offers.splice(waiting, 1);
      offer.run.finish(null, "", "annulée avant la prise en charge\n");
      return;
    }
    for (const lease of this.#leases.values())
      if (lease.ticket.id === sessionId && !lease.cancelled) {
        lease.cancelled = true;
        lease.run.finish(null, "", "annulée\n");
        return;
      }
  }

  /** Échoue les baux sans signe de vie ; oublie les baux annulés dont l'agent n'est jamais revenu. */
  reap(now = Date.now()): number {
    let expired = 0;
    for (const [id, lease] of this.#leases) {
      if (lease.expiresAt > now) continue;
      this.#leases.delete(id);
      if (!lease.cancelled) {
        expired++;
        lease.run.finish(
          1,
          "",
          "Le moteur distant a cessé de répondre (aucun signal de vie).\n",
        );
      }
    }
    // Réévalue les agents qui attendent : un agent préféré disparu libère le secours sans attendre son prochain appel.
    if (this.#offers.length > 0) this.#dispatch(now);
    return expired;
  }

  #startReaper(): void {
    if (this.#reaper) return;
    this.#reaper = setInterval(() => this.reap(), 5_000);
    this.#reaper.unref?.();
  }

  status(): { waiting: number; leased: number } {
    return {
      waiting: this.#offers.length,
      leased: [...this.#leases.values()].filter((l) => !l.cancelled).length,
    };
  }

  /** Pour les tests : arrête le minuteur et oublie tout. */
  reset(): void {
    if (this.#reaper) clearInterval(this.#reaper);
    this.#reaper = undefined;
    for (const waiter of [...this.#waiters]) this.#drop(waiter, null);
    // Les analyses encore attendues sont interrompues : sinon la file ne se vide jamais.
    for (const offer of this.#offers) offer.run.finish(null, "", INTERRUPTED);
    for (const lease of this.#leases.values())
      lease.run.finish(null, "", INTERRUPTED);
    this.#offers.length = 0;
    this.#leases.clear();
  }
}

export class UnknownLeaseError extends Error {
  constructor() {
    super("Bail inconnu ou expiré");
    this.name = "UnknownLeaseError";
  }
}

const GLOBAL = Symbol.for("aqr.engine-broker");
export function engineBroker(): EngineBroker {
  const holder = globalThis as { [GLOBAL]?: EngineBroker };
  // Premier choix / secours : un agent de secours attend tant qu'un agent préféré est en ligne et libre.
  return (holder[GLOBAL] ??= new EngineBroker({
    mayClaim: (agentId, { busy, now }) =>
      !preferredAgentAvailable(getDb(), agentId, busy, now),
    agentName: (agentId) =>
      listAgents(getDb()).find((a) => a.id === agentId)?.name ?? null,
  }));
}

export const remoteEngineEnabled = (
  env: Record<string, string | undefined> = process.env,
): boolean => env.AQR_ENGINE === "remote";
