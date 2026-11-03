import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EngineBroker,
  RESULT_FILE,
  UnknownLeaseError,
  leaseSeconds,
  type Ticket,
} from "./engine-broker";

let dir = "";
let broker: EngineBroker;
const SHA = "a".repeat(64);
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-broker-"));
  broker = new EngineBroker();
  vi.stubEnv("AQR_ENGINE_LEASE_S", "30");
});
afterEach(async () => {
  broker.reset();
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const ticket = (id: string, over: Partial<Ticket> = {}): Ticket => ({
  id,
  asr: "fastconformer-quran@b33a",
  audioFile: path.join(dir, id, "source.mp3"),
  audioSha256: SHA,
  audioSize: 100,
  outDir: path.join(dir, id),
  ...over,
});
const recognition = (hash = SHA) =>
  Buffer.from(
    JSON.stringify({
      schema: "aqr.recognition/1",
      source: { file: "source.mp3", sha256: hash, duration_s: 10 },
      engine: {
        asr: "fastconformer-quran@b33a",
        segmenter: "s",
        matcher: "m",
        decoder: "d",
        constrained: false,
        corpus: "c",
      },
      decoder: {},
      timing: {},
      windows: 1,
      warnings: [],
      intervals: [],
    }),
  );
/** Résultat de `close` du faux processus : code et sortie d'erreur. */
function watch(run: ReturnType<EngineBroker["offer"]>) {
  const out = { code: undefined as number | null | undefined, err: "" };
  run.stderr?.on("data", (c: Buffer) => (out.err += c.toString()));
  run.on("close", (code) => (out.code = code));
  return out;
}
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("courtier du moteur distant", () => {
  it("l'ordre d'arrivée est respecté et un agent ne tient qu'un bail à la fois", () => {
    broker.offer(ticket("s1"));
    broker.offer(ticket("s2"));
    const a = broker.claim(1);
    expect(a?.ticket.id).toBe("s1");
    expect(broker.claim(1)).toBeNull(); // déjà occupé
    expect(broker.claim(2)?.ticket.id).toBe("s2");
    expect(broker.claim(3)).toBeNull();
    expect(broker.status()).toEqual({ waiting: 0, leased: 2 });
  });

  it("le bail d'un agent est invisible pour un autre agent", () => {
    broker.offer(ticket("s1"));
    const lease = broker.claim(1)!;
    expect(broker.lease(lease.id, 1)).not.toBeNull();
    expect(broker.lease(lease.id, 2)).toBeNull();
    expect(broker.heartbeat(lease.id, 2)).toBeNull();
    expect(broker.fail(lease.id, 2, "x")).toBe(false);
    expect(broker.lease("0".repeat(32), 1)).toBeNull();
  });

  it("long polling : un agent en attente reçoit l'analyse dès qu'elle est offerte", async () => {
    const waiting = broker.claimWait(1, 5_000);
    broker.offer(ticket("s1"));
    expect((await waiting)?.ticket.id).toBe("s1");
  });

  it("long polling : sans analyse, rend null à l'échéance ; un abandon libère aussi", async () => {
    expect(await broker.claimWait(1, 10)).toBeNull();
    const controller = new AbortController();
    const waiting = broker.claimWait(1, 60_000, controller.signal);
    controller.abort();
    expect(await waiting).toBeNull();
  });

  it("résultat valide : écrit UN fichier, termine avec le code 0", async () => {
    const run = broker.offer(ticket("s1"));
    const seen = watch(run);
    const lease = broker.claim(1)!;
    await broker.complete(lease.id, 1, recognition());
    await settle();
    expect(seen.code).toBe(0);
    expect(await readdir(path.join(dir, "s1"))).toEqual([RESULT_FILE]);
    expect(
      JSON.parse(await readFile(path.join(dir, "s1", RESULT_FILE), "utf8"))
        .source.sha256,
    ).toBe(SHA);
    expect(broker.lease(lease.id, 1)).toBeNull(); // bail consommé
  });

  it("résultat avec l'empreinte d'un autre audio, ou hors contrat : refusé, rien n'est écrit", async () => {
    const run = broker.offer(ticket("s1"));
    watch(run);
    const lease = broker.claim(1)!;
    await expect(
      broker.complete(lease.id, 1, recognition("b".repeat(64))),
    ).rejects.toThrow(/Empreinte/);
    await expect(
      broker.complete(lease.id, 1, Buffer.from('{"schema":"autre"}')),
    ).rejects.toThrow();
    await expect(
      broker.complete(lease.id, 1, Buffer.from("pas du json")),
    ).rejects.toThrow();
    await expect(readdir(path.join(dir, "s1"))).rejects.toThrow(); // dossier jamais créé
  });

  it("un autre agent ne peut pas déposer le résultat d'un bail qui n'est pas le sien", async () => {
    broker.offer(ticket("s1"));
    const lease = broker.claim(1)!;
    await expect(broker.complete(lease.id, 2, recognition())).rejects.toThrow(
      UnknownLeaseError,
    );
  });

  it("échec annoncé par l'agent : code 1 et message borné sur une ligne", async () => {
    const seen = watch(broker.offer(ticket("s1")));
    const lease = broker.claim(1)!;
    expect(broker.fail(lease.id, 1, "boom\n".repeat(200))).toBe(true);
    await settle();
    expect(seen.code).toBe(1);
    expect(seen.err.split("\n").at(-2)!.length).toBeLessThanOrEqual(300);
  });

  it("sans signal de vie, le bail expire : échec explicite, pas de silence", async () => {
    const seen = watch(broker.offer(ticket("s1")));
    const lease = broker.claim(1, 1_000)!;
    expect(broker.reap(1_000 + 29_000)).toBe(0);
    expect(broker.heartbeat(lease.id, 1, 1_000 + 29_000)).toEqual({
      cancel: false,
    });
    expect(broker.reap(1_000 + 29_000 + 31_000)).toBe(1);
    await settle();
    expect(seen.code).toBe(1);
    expect(seen.err).toMatch(/cessé de répondre/);
    expect(broker.lease(lease.id, 1)).toBeNull();
  });

  it("annulation avant la prise en charge : retirée de l'attente, personne ne la verra", async () => {
    const run = broker.offer(ticket("s1"));
    const seen = watch(run);
    run.kill();
    await settle();
    expect(seen.code).toBeNull();
    expect(broker.claim(1)).toBeNull();
  });

  it("annulation pendant l'analyse : l'agent l'apprend au signal de vie, son résultat est refusé", async () => {
    const run = broker.offer(ticket("s1"));
    const seen = watch(run);
    const lease = broker.claim(1)!;
    run.kill();
    await settle();
    expect(seen.code).toBeNull();
    expect(broker.heartbeat(lease.id, 1)).toEqual({ cancel: true });
    await expect(broker.complete(lease.id, 1, recognition())).rejects.toThrow(
      UnknownLeaseError,
    );
    // Un agent annulé peut réclamer de nouveau : le bail annulé ne le bloque pas.
    broker.offer(ticket("s2"));
    expect(broker.claim(1)?.ticket.id).toBe("s2");
  });

  it("la durée du bail se règle par l'environnement, bornée", () => {
    expect(leaseSeconds("30")).toBe(30);
    expect(leaseSeconds("1")).toBe(90);
    expect(leaseSeconds("99999")).toBe(90);
    expect(leaseSeconds("abc")).toBe(90);
  });
});

describe("règle de priorité entre agents (premier choix / secours)", () => {
  it("un agent que la règle écarte ne reçoit rien ; l'autre reçoit l'analyse", () => {
    const strict = new EngineBroker({ mayClaim: (agentId) => agentId === 1 });
    strict.offer(ticket("s1"));
    expect(strict.claim(2)).toBeNull(); // le secours est écarté
    expect(strict.status().waiting).toBe(1); // l'analyse reste en attente
    expect(strict.claim(1)?.ticket.id).toBe("s1");
    strict.reset();
  });

  it("la règle sait qui est occupé (a un bail en cours)", () => {
    const seen: boolean[] = [];
    const watching = new EngineBroker({
      mayClaim: (agentId, ctx) => {
        if (agentId === 2) seen.push(ctx.busy(1));
        return true;
      },
    });
    watching.offer(ticket("s1"));
    watching.offer(ticket("s2"));
    watching.claim(2); // l'agent 1 ne tient encore rien
    expect(seen).toEqual([false]);
    watching.reset();
    watching.offer(ticket("s3"));
    watching.claim(1); // l'agent 1 prend un bail
    watching.offer(ticket("s4"));
    watching.claim(2);
    expect(seen.at(-1)).toBe(true);
    expect(watching.isBusy(1)).toBe(true);
    expect(watching.isBusy(3)).toBe(false);
    watching.reset();
  });

  it("un agent écarté qui attend reçoit l'analyse dès que la règle l'autorise (réveil périodique)", async () => {
    let allowed = false;
    const waiting = new EngineBroker({ mayClaim: () => allowed });
    waiting.offer(ticket("s1"));
    const pending = waiting.claimWait(2, 60_000);
    expect(waiting.status().waiting).toBe(1);
    allowed = true; // l'agent préféré vient de disparaître
    waiting.reap(); // le réveil périodique réévalue les agents en attente
    expect((await pending)?.ticket.id).toBe("s1");
    waiting.reset();
  });

  it("sans règle, comportement inchangé : le premier qui appelle prend l'analyse", () => {
    broker.offer(ticket("s1"));
    expect(broker.claim(2)?.ticket.id).toBe("s1");
  });
});

describe("agent qui a pris l'analyse", () => {
  it("note le nom de l'agent sur l'exécution dès la prise en charge", () => {
    const named = new EngineBroker({
      agentName: (id) => (id === 7 ? "REVERB" : null),
    });
    const run = named.offer(ticket("s1")) as { agentName?: string | null };
    expect(run.agentName ?? null).toBeNull(); // personne ne l'a encore prise
    named.claim(7);
    expect(run.agentName).toBe("REVERB");
    named.reset();
  });

  it("garde une trace même si le nom est inconnu (agent supprimé)", () => {
    const named = new EngineBroker({ agentName: () => null });
    const run = named.offer(ticket("s2")) as { agentName?: string | null };
    named.claim(9);
    expect(run.agentName).toBe("agent n°9");
    named.reset();
  });

  it("sans fonction de nom, retombe sur le numéro", () => {
    const run = broker.offer(ticket("s3")) as { agentName?: string | null };
    broker.claim(3);
    expect(run.agentName).toBe("agent n°3");
  });
});
