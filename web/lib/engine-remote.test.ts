import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Moteur distant de bout en bout (ADR-0017) : une vraie file, de vraies routes, un faux agent qui parle HTTP
 * aux routes comme le ferait l'agent Python. Aucun moteur local : AQR_MODELS_DIR est absent.
 */
const ID = (n: number) =>
  `0f0e0d0c-0b0a-4908-8706-0504030201${String(n).padStart(2, "0")}`;
const [A, B] = [ID(1), ID(2)];
const HOST = "http://127.0.0.1:3000";

let tmp = "";
let tokens: { one: string; two: string; user: string; admin: string } = {
  one: "",
  two: "",
  user: "",
  admin: "",
};
let agentIds = { one: 0, two: 0 };
let cookie = "";

async function modules() {
  return {
    jobs: await import("./jobs"),
    store: await import("./store"),
    broker: await import("./engine-broker"),
    queue: await import("./queue"),
    claim: await import("@/app/api/engine/claim/route"),
    audio: await import("@/app/api/engine/leases/[lease]/audio/route"),
    beat: await import("@/app/api/engine/leases/[lease]/heartbeat/route"),
    result: await import("@/app/api/engine/leases/[lease]/result/route"),
    fail: await import("@/app/api/engine/leases/[lease]/fail/route"),
    admin: await import("@/app/api/admin/engine-agents/route"),
    adminOne: await import("@/app/api/admin/engine-agents/[id]/route"),
  };
}
let m: Awaited<ReturnType<typeof modules>>;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-remote-"));
  vi.stubEnv("AQR_REVIEW_DIR", path.join(tmp, "review"));
  vi.stubEnv("AQR_ENGINE", "remote");
  vi.stubEnv("AQR_MODELS_DIR", "");
  vi.stubEnv("AQR_ENGINE_LEASE_S", "30");
  m = await modules();
  m.jobs.resetQueueRecovery();
  const { getDb } = await import("./db");
  const { createUser } = await import("./users");
  const { createLogin, authConfig } = await import("./auth");
  const { createAgent } = await import("./engine-agents");
  const { createApiToken } = await import("./api-tokens");
  const db = getDb();
  const admin = createUser(db, { username: "admin1", passwordHash: "x" });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  const user = createUser(db, { username: "awa", passwordHash: "x" });
  const one = createAgent(db, { name: "poste GPU", createdBy: admin.id });
  const two = createAgent(db, { name: "second", createdBy: admin.id });
  agentIds = { one: one.row.id, two: two.row.id };
  tokens = {
    one: one.token,
    two: two.token,
    user: createApiToken(db, { userId: user.id, name: "t", scope: "write" })
      .token,
    admin: "",
  };
  cookie = createLogin(db, admin.id, authConfig());
});
afterEach(async () => {
  m.broker.engineBroker().reset();
  await m.jobs.jobQueue().idle();
  m.queue.resetSharedQueue();
  vi.unstubAllEnvs();
  const { closeDb } = await import("./db");
  closeDb();
  await rm(tmp, { recursive: true, force: true });
});

async function seed(id: string, text = `audio-${id}`) {
  const bytes = Buffer.from(text);
  await m.store.saveSession({
    id,
    name: "a.mp3",
    extension: ".mp3",
    audio_sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    source_kind: "file",
    created_at: "2026-10-22T08:00:00.000Z",
    state: "ready",
    error: null,
    started_at: null,
    finished_at: null,
    prediction_sha256: null,
    pid: null,
  });
  await writeFile(path.join(m.store.sessionDir(id), "source.mp3"), bytes);
  return { bytes, sha: createHash("sha256").update(bytes).digest("hex") };
}
const recognition = (sha: string) =>
  JSON.stringify({
    schema: "aqr.recognition/1",
    source: { file: "source.mp3", sha256: sha, duration_s: 12 },
    engine: {
      asr: "cascade(fastconformer-quran@b33a)",
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
  });
const bearer = (token: string | null): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {};
const until = async (
  predicate: () => Promise<boolean> | boolean,
  ms = 6000,
) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error("condition jamais atteinte");
};
const state = async (id: string) => (await m.store.readSession(id)).state;

const claim = (token: string | null, wait = 0) =>
  m.claim.POST(
    new Request(`${HOST}/api/engine/claim?wait=${wait}`, {
      method: "POST",
      headers: bearer(token),
    }),
  );
const lease = (
  token: string | null,
  id: string,
  part: string,
  init: RequestInit = {},
) =>
  new Request(`${HOST}/api/engine/leases/${id}/${part}`, {
    ...init,
    headers: { ...bearer(token), ...(init.headers as object) },
  });
const ctx = (id: string) => ({ params: Promise.resolve({ lease: id }) });

describe("moteur distant : parcours normal", () => {
  it("l'analyse attend un agent, qui la réclame, télécharge l'audio, signale sa vie et dépose le résultat", async () => {
    const { bytes, sha } = await seed(A);
    await m.jobs.launch(A);
    await until(async () => (await state(A)) === "running");
    expect(m.broker.engineBroker().status()).toEqual({ waiting: 1, leased: 0 });

    const claimed = await claim(tokens.one);
    expect(claimed.status).toBe(200);
    const body = await claimed.json();
    expect(body.session).toBe(A);
    expect(body.audio.sha256).toBe(sha);

    const audio = await m.audio.GET(
      lease(tokens.one, body.lease, "audio"),
      ctx(body.lease),
    );
    expect(audio.status).toBe(200);
    expect(Buffer.from(await audio.arrayBuffer()).equals(bytes)).toBe(true);

    const beat = await m.beat.POST(
      lease(tokens.one, body.lease, "heartbeat", { method: "POST" }),
      ctx(body.lease),
    );
    expect(await beat.json()).toEqual({ cancel: false });

    const put = await m.result.PUT(
      lease(tokens.one, body.lease, "result", {
        method: "PUT",
        body: recognition(sha),
      }),
      ctx(body.lease),
    );
    expect(put.status).toBe(200);
    await until(async () => (await state(A)) === "done");
    const dir = m.store.sessionDir(A);
    expect(existsSync(path.join(dir, "prediction.recognition.json"))).toBe(
      true,
    );
    expect(
      JSON.parse(
        await readFile(path.join(dir, "prediction.recognition.json"), "utf8"),
      ).source.sha256,
    ).toBe(sha);
    // L'atelier retient quel agent a fait l'analyse, pour l'afficher dans la liste et l'en-tête.
    await until(
      async () => (await m.store.readSession(A)).engine_agent === "poste GPU",
    );
  });

  it("sans agent en ligne l'analyse reste en attente ; un agent qui arrive plus tard la prend", async () => {
    const { sha } = await seed(A);
    await m.jobs.launch(A);
    await new Promise((r) => setTimeout(r, 100));
    expect(await state(A)).toBe("running");
    const waiting = claim(tokens.one, 5); // long polling déjà posé quand l'analyse arrive
    const got = await waiting;
    expect(got.status).toBe(200);
    const body = await got.json();
    await m.result.PUT(
      lease(tokens.one, body.lease, "result", {
        method: "PUT",
        body: recognition(sha),
      }),
      ctx(body.lease),
    );
    await until(async () => (await state(A)) === "done");
  });

  it("deux analyses : l'agent les traite l'une après l'autre, dans l'ordre", async () => {
    const a = await seed(A);
    const b = await seed(B);
    await m.jobs.launch(A);
    await m.jobs.launch(B);
    const first = await (await claim(tokens.one, 2)).json();
    expect(first.session).toBe(A);
    expect((await claim(tokens.one)).status).toBe(204); // déjà occupé
    await m.result.PUT(
      lease(tokens.one, first.lease, "result", {
        method: "PUT",
        body: recognition(a.sha),
      }),
      ctx(first.lease),
    );
    await until(async () => (await state(A)) === "done");
    const second = await (await claim(tokens.one, 5)).json();
    expect(second.session).toBe(B);
    await m.result.PUT(
      lease(tokens.one, second.lease, "result", {
        method: "PUT",
        body: recognition(b.sha),
      }),
      ctx(second.lease),
    );
    await until(async () => (await state(B)) === "done");
  });
});

describe("moteur distant : cas d'échec, dits clairement", () => {
  it("résultat d'un autre audio : refusé (422) et l'analyse échoue avec un message lisible", async () => {
    await seed(A);
    await m.jobs.launch(A);
    const body = await (await claim(tokens.one, 2)).json();
    const put = await m.result.PUT(
      lease(tokens.one, body.lease, "result", {
        method: "PUT",
        body: recognition("b".repeat(64)),
      }),
      ctx(body.lease),
    );
    expect(put.status).toBe(422);
    await until(async () => (await state(A)) === "failed");
    expect((await m.store.readSession(A)).error).toMatch(/invalide/);
  });

  it("l'agent annonce un échec : son message est la raison affichée", async () => {
    await seed(A);
    await m.jobs.launch(A);
    const body = await (await claim(tokens.one, 2)).json();
    const res = await m.fail.POST(
      lease(tokens.one, body.lease, "fail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "mémoire GPU saturée" }),
      }),
      ctx(body.lease),
    );
    expect(res.status).toBe(200);
    await until(async () => (await state(A)) === "failed");
    expect((await m.store.readSession(A)).error).toMatch(/mémoire GPU saturée/);
    await until(
      async () => (await m.store.readSession(A)).engine_agent === "poste GPU",
    );
  });

  it("agent disparu : le bail expire et l'analyse échoue explicitement", async () => {
    await seed(A);
    await m.jobs.launch(A);
    await (await claim(tokens.one, 2)).json();
    m.broker.engineBroker().reap(Date.now() + 120_000);
    await until(async () => (await state(A)) === "failed");
    expect((await m.store.readSession(A)).error).toMatch(/cessé de répondre/);
  });

  it("annulation par l'utilisateur : l'agent l'apprend au signal de vie et son résultat est refusé", async () => {
    const { sha } = await seed(A);
    await m.jobs.launch(A);
    const body = await (await claim(tokens.one, 2)).json();
    await m.jobs.cancel(A);
    await until(async () => (await state(A)) === "cancelled");
    const beat = await m.beat.POST(
      lease(tokens.one, body.lease, "heartbeat", { method: "POST" }),
      ctx(body.lease),
    );
    expect(await beat.json()).toEqual({ cancel: true });
    const put = await m.result.PUT(
      lease(tokens.one, body.lease, "result", {
        method: "PUT",
        body: recognition(sha),
      }),
      ctx(body.lease),
    );
    expect(put.status).toBe(404);
    expect(await state(A)).toBe("cancelled");
  });
});

describe("moteur distant : qui a le droit de quoi", () => {
  it("sans jeton, avec un jeton d'utilisateur, avec un cookie de connexion ou un faux jeton : 401 partout", async () => {
    await seed(A);
    await m.jobs.launch(A);
    const forged = "qea_" + "A".repeat(43);
    const tries: Array<Record<string, string>> = [
      {},
      bearer(tokens.user),
      bearer(forged),
      bearer("n'importe quoi"),
      { cookie: `aqr_session=${cookie}` },
    ];
    for (const headers of tries) {
      const res = await m.claim.POST(
        new Request(`${HOST}/api/engine/claim?wait=0`, {
          method: "POST",
          headers,
        }),
      );
      expect(res.status, JSON.stringify(Object.keys(headers))).toBe(401);
    }
    expect(m.broker.engineBroker().status().waiting).toBe(1); // rien n'a été pris
  });

  it("dans un conteneur (URL en 0.0.0.0), l'agent passe l'hôte public mais pas un hôte étranger", async () => {
    vi.stubEnv("AQR_ACCESS_TOKEN", "t".repeat(40));
    vi.stubEnv("AQR_PUBLIC_ORIGIN", "https://atelier.example");
    const claim = (host: string) =>
      m.claim.POST(
        new Request("http://0.0.0.0:3000/api/engine/claim?wait=0", {
          method: "POST",
          headers: { host, ...bearer(tokens.one) },
        }),
      );
    // Sans la déclaration d'écoute, l'hôte de l'URL (0.0.0.0) n'est pas reconnu : refus.
    expect((await claim("atelier.example")).status).toBe(403);
    vi.stubEnv("AQR_SERVER_HOST", "0.0.0.0");
    expect((await claim("atelier.example")).status).toBe(204); // authentifié, rien à analyser
    expect((await claim("evil.example")).status).toBe(403);
    expect((await claim("0.0.0.0:3000")).status).toBe(403);
  });

  it("un jeton d'agent n'ouvre aucune autre route de l'atelier", async () => {
    const sessions = await import("@/app/api/sessions/route");
    const res = await sessions.GET(
      new NextRequest(`${HOST}/api/sessions`, { headers: bearer(tokens.one) }),
    );
    expect(res.status).toBe(401);
  });

  it("un agent ne voit ni n'altère le bail d'un autre agent : 404 partout", async () => {
    const { sha } = await seed(A);
    await m.jobs.launch(A);
    const body = await (await claim(tokens.one, 2)).json();
    const other = tokens.two;
    expect(
      (await m.audio.GET(lease(other, body.lease, "audio"), ctx(body.lease)))
        .status,
    ).toBe(404);
    expect(
      (
        await m.beat.POST(
          lease(other, body.lease, "heartbeat", { method: "POST" }),
          ctx(body.lease),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await m.result.PUT(
          lease(other, body.lease, "result", {
            method: "PUT",
            body: recognition(sha),
          }),
          ctx(body.lease),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await m.fail.POST(
          lease(other, body.lease, "fail", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: '{"message":"x"}',
          }),
          ctx(body.lease),
        )
      ).status,
    ).toBe(404);
    expect(await state(A)).toBe("running");
  });

  it("un agent révoqué ne peut plus rien, dès la requête suivante", async () => {
    await seed(A);
    await m.jobs.launch(A);
    const { getDb } = await import("./db");
    const { revokeAgent } = await import("./engine-agents");
    expect(revokeAgent(getDb(), agentIds.one)).toBe(true);
    expect((await claim(tokens.one)).status).toBe(401);
    expect((await claim(tokens.two, 2)).status).toBe(200);
  });

  it("un résultat trop gros est refusé (413) et fait échouer l'analyse", async () => {
    await seed(A);
    await m.jobs.launch(A);
    const body = await (await claim(tokens.one, 2)).json();
    const put = await m.result.PUT(
      lease(tokens.one, body.lease, "result", {
        method: "PUT",
        headers: { "content-length": String(m.broker.MAX_RESULT_BYTES + 1) },
        body: "{}",
      }),
      ctx(body.lease),
    );
    expect(put.status).toBe(413);
    await until(async () => (await state(A)) === "failed");
  });

  it("un bail inventé ou mal formé : 404, jamais 500", async () => {
    for (const id of ["0".repeat(32), "../../etc/passwd", "x".repeat(5000)]) {
      const res = await m.beat.POST(
        lease(tokens.one, encodeURIComponent(id), "heartbeat", {
          method: "POST",
        }),
        ctx(id),
      );
      expect(res.status).toBe(404);
    }
  });
});

describe("agents : administration", () => {
  const adminCall = (method: string, body?: object) =>
    new Request(`${HOST}/api/admin/engine-agents`, {
      method,
      headers: {
        cookie: `aqr_session=${cookie}`,
        "content-type": "application/json",
        origin: HOST,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  it("un administrateur crée un agent : le jeton clair n'apparaît qu'une fois, jamais dans la liste", async () => {
    const created = await m.admin.POST(
      adminCall("POST", { name: "poste Atlas" }),
    );
    expect(created.status).toBe(201);
    const { token } = await created.json();
    expect(token).toMatch(/^qea_[A-Za-z0-9_-]{43}$/);
    const list = await m.admin.GET(adminCall("GET"));
    const text = JSON.stringify(await list.json());
    expect(text).not.toContain(token);
    expect(text).not.toContain("token_hash");
  });

  it("la liste dit si le moteur est distant, s'il est en ligne, et combien d'analyses attendent", async () => {
    const before = await (await m.admin.GET(adminCall("GET"))).json();
    expect(before).toMatchObject({
      remote: true,
      online: false, // aucun agent n'a encore appelé
      queue: { waiting: 0, leased: 0 },
    });
    await m.claim.POST(
      new Request(`${HOST}/api/engine/claim?wait=0`, {
        method: "POST",
        headers: bearer(tokens.one),
      }),
    );
    expect((await (await m.admin.GET(adminCall("GET"))).json()).online).toBe(
      true,
    );
    await seed(A);
    await m.jobs.launch(A, undefined, 1);
    await until(async () => m.broker.engineBroker().status().waiting === 1);
    const during = await (await m.admin.GET(adminCall("GET"))).json();
    expect(during.queue).toEqual({ waiting: 1, leased: 0 });
  });

  it("l'administrateur monte ou descend un agent : l'ordre de la liste suit, les bouts refusés", async () => {
    const move = (id: number, direction: unknown, who = "admin") =>
      m.adminOne.PATCH(
        new Request(`${HOST}/api/admin/engine-agents/${id}`, {
          method: "PATCH",
          headers: {
            ...(who === "admin" ? { cookie: `aqr_session=${cookie}` } : {}),
            "content-type": "application/json",
            origin: HOST,
          },
          body: JSON.stringify({ move: direction }),
        }),
        { params: Promise.resolve({ id: String(id) }) },
      );
    const order = async () =>
      (await (await m.admin.GET(adminCall("GET"))).json()).items.map(
        (a: { name: string }) => a.name,
      );
    expect(await order()).toEqual(["poste GPU", "second"]);
    expect((await move(agentIds.two, "up")).status).toBe(200);
    expect(await order()).toEqual(["second", "poste GPU"]);
    expect((await move(agentIds.two, "up")).status).toBe(409); // déjà premier
    expect((await move(agentIds.one, "down")).status).toBe(409); // déjà dernier
    expect((await move(agentIds.two, "sideways")).status).toBe(400);
    expect((await move(99999, "up")).status).toBe(404);
    expect((await move(agentIds.one, "up", "anonyme")).status).toBe(401);
  });

  it("moteur local : la liste le dit (remote: false), sans file d'attente à distance", async () => {
    vi.stubEnv("AQR_ENGINE", "");
    const out = await (await m.admin.GET(adminCall("GET"))).json();
    expect(out.remote).toBe(false);
  });

  it("un utilisateur ordinaire, ou sans connexion, ne peut ni lister ni créer ni révoquer", async () => {
    const anon = (method: string) =>
      new Request(`${HOST}/api/admin/engine-agents`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? '{"name":"x"}' : undefined,
      });
    expect((await m.admin.GET(anon("GET"))).status).toBe(401);
    expect((await m.admin.POST(anon("POST"))).status).toBe(401);
    const del = await m.adminOne.DELETE(
      new Request(`${HOST}/api/admin/engine-agents/1`, { method: "DELETE" }),
      { params: Promise.resolve({ id: "1" }) },
    );
    expect(del.status).toBe(401);
  });

  it("champ inconnu, nom vide ou vingt agents : refusés proprement", async () => {
    expect((await m.admin.POST(adminCall("POST", { name: "" }))).status).toBe(
      400,
    );
    expect(
      (await m.admin.POST(adminCall("POST", { name: "ok", extra: 1 }))).status,
    ).toBe(400);
    for (let i = 0; i < 3; i++)
      await m.admin.POST(adminCall("POST", { name: `a${i}` }));
    expect(
      (await m.admin.POST(adminCall("POST", { name: "de trop" }))).status,
    ).toBe(409);
  });

  it("révoquer un agent inconnu : 404", async () => {
    const res = await m.adminOne.DELETE(
      new Request(`${HOST}/api/admin/engine-agents/999`, {
        method: "DELETE",
        headers: { cookie: `aqr_session=${cookie}`, origin: HOST },
      }),
      { params: Promise.resolve({ id: "999" }) },
    );
    expect(res.status).toBe(404);
  });
});

describe("premier choix / secours entre agents", () => {
  // Les agents du banc de test sont créés dans l'ordre : `one` est le premier choix, `two` le secours.
  const setSeen = async (agentId: number, msAgo: number) => {
    const { getDb } = await import("./db");
    getDb()
      .prepare("UPDATE engine_agents SET last_seen_at = ? WHERE id = ?")
      .run(new Date(Date.now() - msAgo).toISOString(), agentId);
  };
  const offer = async (id: string) => {
    await seed(id);
    await m.jobs.launch(id, undefined, 1);
    await until(() => m.broker.engineBroker().status().waiting >= 1);
  };

  it("le premier choix est en ligne et libre : le secours attend, le premier choix prend l'analyse", async () => {
    await setSeen(agentIds.one, 5_000);
    await offer(A);
    expect((await claim(tokens.two)).status).toBe(204); // le secours ne reçoit rien
    expect(m.broker.engineBroker().status().waiting).toBe(1); // l'analyse attend toujours
    const res = await claim(tokens.one);
    expect(res.status).toBe(200);
    expect((await res.json()).session).toBe(A);
  });

  it("le premier choix est occupé : le secours prend l'analyse suivante (deux en parallèle)", async () => {
    // Par défaut la file sert UNE analyse à la fois ; deux agents permettent d'en servir deux.
    vi.stubEnv("AQR_MAX_CONCURRENT", "2");
    await setSeen(agentIds.one, 5_000);
    await offer(A);
    expect((await claim(tokens.one)).status).toBe(200); // `one` tient A
    await offer(B);
    const res = await claim(tokens.two);
    expect(res.status).toBe(200);
    expect((await res.json()).session).toBe(B);
  });

  it("le premier choix est silencieux (PC éteint) : le secours prend l'analyse", async () => {
    await setSeen(agentIds.one, 10 * 60_000);
    await offer(A);
    expect((await claim(tokens.two)).status).toBe(200);
  });

  it("le premier choix est révoqué : le secours prend l'analyse", async () => {
    await setSeen(agentIds.one, 1_000);
    const { revokeAgent } = await import("./engine-agents");
    const { getDb } = await import("./db");
    revokeAgent(getDb(), agentIds.one);
    await offer(A);
    expect((await claim(tokens.two)).status).toBe(200);
  });

  it("un secours en attente (long polling) reçoit l'analyse quand le premier choix disparaît", async () => {
    await setSeen(agentIds.one, 5_000);
    await offer(A);
    const waiting = claim(tokens.two, 20);
    await setSeen(agentIds.one, 10 * 60_000); // le premier choix s'éteint
    m.broker.engineBroker().reap(); // réveil périodique
    const res = await waiting;
    expect(res.status).toBe(200);
  });

  it("l'ordre est modifiable : en montant le secours, c'est lui qui prend d'abord", async () => {
    const { moveAgent } = await import("./engine-agents");
    const { getDb } = await import("./db");
    expect(moveAgent(getDb(), agentIds.two, "up")).toBe(true);
    await setSeen(agentIds.two, 5_000);
    await offer(A);
    expect((await claim(tokens.one)).status).toBe(204); // `one` est devenu le secours
    expect((await claim(tokens.two)).status).toBe(200);
  });
});
