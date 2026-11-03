import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Le rendu réel (navigateur sans interface) n'est pas lancé ici : le travail est remplacé par un rendu vide.
vi.mock("@/lib/video-jobs", async (original) => {
  const real = await original<typeof import("@/lib/video-jobs")>();
  return {
    ...real,
    startVideoJob: (input: Parameters<typeof real.startVideoJob>[0]) =>
      real.startVideoJob({ ...input, runner: async () => undefined }),
  };
});

/**
 * Export avec une vidéo de fond choisie : la route de lancement contrôle que la vidéo est BIEN celle de ce
 * compte, pour CETTE session, et prête ; le navigateur de rendu la lit ensuite par une route propre au job.
 */
const HOST = "http://127.0.0.1:3000";
const CHUNK = 1024;
const MINE = "00000000-0000-4000-8000-0000000000d1";
const MINE_2 = "00000000-0000-4000-8000-0000000000d3";
const THEIRS = "00000000-0000-4000-8000-0000000000d2";
let tmp = "";
let cookies = { awa: "", bou: "" };
let ids = { awa: 0, bou: 0 };

const FAKE_COPY = Buffer.from("0123456789".repeat(100));
async function fakeDeps() {
  const { sniffFile } = await import("@/lib/import-session");
  return {
    sniff: sniffFile,
    probe: async () => ({
      duration: 9,
      width: 640,
      height: 360,
      codec: "h264",
    }),
    normalize: async ({ output }: { output: string }) =>
      writeFile(output, FAKE_COPY),
    freeBytes: async () => null,
    now: () => Date.now(),
  };
}
const mp4 = (size: number) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from("ftypisom"),
    Buffer.alloc(size - 12, 7),
  ]);

/** Une vidéo de fond prête pour (compte, session). */
async function readyClip(owner: number, session: string) {
  const store = await import("@/lib/background-video-store");
  const deps = await fakeDeps();
  const data = mp4(CHUNK + 40);
  const ctx = { sessionId: session, ownerId: owner };
  const made = await store.createClip(
    { ...ctx, filename: "fond.mp4", size: data.length },
    deps,
  );
  for (const [index, start] of [0, CHUNK].entries())
    await store.receiveClipChunk({
      ...ctx,
      id: made.id,
      index,
      body: data.subarray(start, start + CHUNK),
    });
  await store.completeClip({ ...ctx, id: made.id }, deps);
  await store.settledClip(made.id);
  return made.id;
}

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-job-clip-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
  vi.stubEnv("AQR_UPLOAD_CHUNK_BYTES", String(CHUNK));
  vi.stubEnv("AQR_MIN_UPLOAD_CHUNK_BYTES", "256");
  // Le navigateur de rendu n'est pas utilisé (runner remplacé) ; l'origine n'a pas d'importance.
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const { createMeta } = await import("@/lib/session-index");
  const { saveSession } = await import("@/lib/store");
  const db = getDb();
  createUser(db, { username: "chef", passwordHash: "x" }); // premier compte = administrateur
  const awa = createUser(db, { username: "awa", passwordHash: "x" });
  const bou = createUser(db, { username: "bou", passwordHash: "x" });
  ids = { awa: awa.id, bou: bou.id };
  cookies = {
    awa: createLogin(db, awa.id, authConfig()),
    bou: createLogin(db, bou.id, authConfig()),
  };
  for (const [id, owner] of [
    [MINE, awa.id],
    [MINE_2, awa.id],
    [THEIRS, bou.id],
  ] as const) {
    createMeta(db, {
      id,
      ownerId: owner,
      name: "essai",
      nameSource: "auto",
      originalName: "a.mp3",
      sourceKind: "file",
      visibility: "private",
      createdAt: "2026-10-01T00:00:00.000Z",
      sizeBytes: 1,
    });
    await saveSession({
      id,
      name: "audio.mp3",
      extension: ".mp3",
      audio_sha256: "a".repeat(64),
      size: 1,
      source_kind: "file",
      created_at: "2026-10-01T00:00:00.000Z",
      state: "done",
      error: null,
      started_at: null,
      finished_at: null,
      prediction_sha256: null,
      pid: null,
    });
  }
});
afterEach(async () => {
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(tmp, { recursive: true, force: true });
});

const as = (who: keyof typeof cookies) => ({
  cookie: `aqr_session=${cookies[who]}`,
});
const launch = async (
  session: string,
  who: keyof typeof cookies,
  options: unknown,
) => {
  const route = await import("./route");
  return route.POST(
    new NextRequest(`${HOST}/api/sessions/${session}/export/video/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...as(who) },
      body: JSON.stringify({ options }),
    }),
    { params: Promise.resolve({ id: session }) },
  );
};
const fileOf = async (
  session: string,
  job: string,
  who: keyof typeof cookies,
  headers: Record<string, string> = {},
) => {
  const route = await import("./[job]/background-video/route");
  return route.GET(
    new NextRequest(
      `${HOST}/api/sessions/${session}/export/video/jobs/${job}/background-video`,
      { headers: { ...as(who), ...headers } },
    ),
    { params: Promise.resolve({ id: session, job }) },
  );
};

describe("lancer un export avec une vidéo de fond", () => {
  it("202 : la vidéo du compte, pour cette session, prête, entre dans le dossier du job", async () => {
    const upload = await readyClip(ids.awa, MINE);
    const response = await launch(MINE, "awa", {
      background: { video: { upload_id: upload, offset: 1, mode: "loop" } },
    });
    expect(response.status).toBe(202);
    const { job } = await response.json();
    const { getVideoJob } = await import("@/lib/video-jobs");
    const kept = getVideoJob(job.id);
    expect(kept?.backgroundVideo).toContain("background-video.mp4");
    const { readFile } = await import("node:fs/promises");
    expect(await readFile(kept?.backgroundVideo as string)).toEqual(FAKE_COPY);
    // la vue publique ne dit rien du fichier
    expect(JSON.stringify(job)).not.toContain("background-video");
  });

  it("une vidéo d'un AUTRE compte est « inconnue » : 404 missing, aucun job", async () => {
    const theirs = await readyClip(ids.bou, THEIRS);
    const response = await launch(MINE, "awa", {
      background: { video: { upload_id: theirs } },
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.code).toBe("missing");
    expect(body.error).toMatch(/export/i);
  });

  it("une vidéo envoyée pour une AUTRE session de ce compte n'est pas utilisable ici", async () => {
    const other = await readyClip(ids.awa, MINE_2);
    const response = await launch(MINE, "awa", {
      background: { video: { upload_id: other } },
    });
    expect(response.status).toBe(404);
  });

  it("la session d'un autre compte est absente : 404, même avec une vidéo valide", async () => {
    const mine = await readyClip(ids.awa, MINE);
    const response = await launch(THEIRS, "awa", {
      background: { video: { upload_id: mine } },
    });
    expect(response.status).toBe(404);
  });

  it("un identifiant inconnu ou supprimé : 404 « missing », expliqué", async () => {
    const response = await launch(MINE, "awa", {
      background: { video: { upload_id: "f".repeat(32) } },
    });
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("missing");
  });

  it("une vidéo encore en préparation : 409 « not_ready », pas d'export lancé", async () => {
    const store = await import("@/lib/background-video-store");
    const deps = await fakeDeps();
    const made = await store.createClip(
      {
        sessionId: MINE,
        ownerId: ids.awa,
        filename: "fond.mp4",
        size: CHUNK,
      },
      deps,
    );
    const response = await launch(MINE, "awa", {
      background: { video: { upload_id: made.id } },
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("not_ready");
  });

  it("une vidéo dont la préparation a échoué : 422 avec la raison", async () => {
    const store = await import("@/lib/background-video-store");
    const deps = {
      ...(await fakeDeps()),
      normalize: async () => {
        throw new Error("ffmpeg a échoué");
      },
    };
    const data = mp4(CHUNK);
    const made = await store.createClip(
      {
        sessionId: MINE,
        ownerId: ids.awa,
        filename: "fond.mp4",
        size: data.length,
      },
      deps,
    );
    await store.receiveClipChunk({
      sessionId: MINE,
      ownerId: ids.awa,
      id: made.id,
      index: 0,
      body: data,
    });
    await store.completeClip(
      { sessionId: MINE, ownerId: ids.awa, id: made.id },
      deps,
    );
    await store.settledClip(made.id);
    const response = await launch(MINE, "awa", {
      background: { video: { upload_id: made.id } },
    });
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("unreadable");
  });

  it("une image de fond ET une vidéo de fond : refusé, on ne devine pas lequel l'emporte", async () => {
    const upload = await readyClip(ids.awa, MINE);
    const route = await import("./route");
    const form = new FormData();
    form.set(
      "options",
      JSON.stringify({ background: { video: { upload_id: upload } } }),
    );
    form.set(
      "background_image",
      new File([Uint8Array.from([137, 80, 78, 71])], "fond.png", {
        type: "image/png",
      }),
    );
    const response = await route.POST(
      new NextRequest(`${HOST}/api/sessions/${MINE}/export/video/jobs`, {
        method: "POST",
        headers: as("awa"),
        body: form,
      }),
      { params: Promise.resolve({ id: MINE }) },
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/image.*vidéo|vidéo.*image/i);
  });

  it("les anciens appelants ne changent pas : un fond en texte, ou aucun fond, partent comme avant", async () => {
    expect(
      (await launch(MINE, "awa", { background: "desert-dunes" })).status,
    ).toBe(202);
    expect((await launch(MINE, "awa", {})).status).toBe(202);
  });

  it("un objet de fond mal formé est refusé en français clair", async () => {
    const response = await launch(MINE, "awa", {
      background: { video: { upload_id: "../../etc" } },
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/upload_id/);
  });
});

describe("lecture de la vidéo par le navigateur de rendu", () => {
  async function startedJob() {
    const upload = await readyClip(ids.awa, MINE);
    const { job } = await (
      await launch(MINE, "awa", {
        background: { video: { upload_id: upload } },
      })
    ).json();
    return job.id as string;
  }

  it("le propriétaire du job la lit, entière ou par intervalles", async () => {
    const job = await startedJob();
    const full = await fileOf(MINE, job, "awa");
    expect(full.status).toBe(200);
    expect(full.headers.get("content-type")).toBe("video/mp4");
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await full.arrayBuffer())).toEqual(FAKE_COPY);
    const part = await fileOf(MINE, job, "awa", { range: "bytes=10-19" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(
      (await fileOf(MINE, job, "awa", { range: "bytes=9000-" })).status,
    ).toBe(416);
  });

  it("un autre compte ne la lit pas : 404", async () => {
    const job = await startedJob();
    expect((await fileOf(MINE, job, "bou")).status).toBe(404);
    expect((await fileOf(THEIRS, job, "bou")).status).toBe(404);
  });

  it("le job d'une autre session ne la donne pas", async () => {
    const job = await startedJob();
    expect((await fileOf(MINE_2, job, "awa")).status).toBe(404);
  });

  it("un job sans vidéo de fond : 404", async () => {
    const { job } = await (await launch(MINE, "awa", {})).json();
    expect((await fileOf(MINE, job.id, "awa")).status).toBe(404);
  });
});
