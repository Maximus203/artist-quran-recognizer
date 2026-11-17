import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Téléchargements : l'administrateur voit tout, les autres comptes ce qu'ils possèdent ou ce qui est
 * public. Contrôlé côté SERVEUR (cas négatifs compris) : l'interface n'est pas une garantie.
 */
let dir = "";
let cookies = { admin: "", me: "", other: "" };
let route: typeof import("./route");
let jobRoute: typeof import("../sessions/[id]/export/video/jobs/[job]/route");
const T = "2026-11-03T14:00:00.000Z";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const S_MINE1 = uuid(1);
const S_MINE2 = uuid(2);
const S_THEIRS = uuid(3);
const S_PUB = uuid(4);
let release: () => void = () => undefined;
const ids: { running: string; waiting: string; theirs: string } = {
  running: "",
  waiting: "",
  theirs: "",
};

const get = (who: "admin" | "me" | "other" | null) =>
  route.GET(
    new Request("http://127.0.0.1:3000/api/downloads", {
      headers: who ? { cookie: `aqr_session=${cookies[who]}` } : {},
    }),
  );
type Item = {
  kind: "file" | "job";
  id: string;
  state?: string;
  can_delete?: boolean;
  can_cancel?: boolean;
  download_url?: string;
  bytes?: number;
};
type Group = {
  session_id: string;
  owner_name: string | null;
  mine: boolean;
  active: number;
  items: Item[];
};
type Body = {
  scope: "mine" | "all";
  groups: Group[];
  total_bytes: number;
  active: number;
  quota: {
    used_bytes: number;
    limit_bytes: number | null;
    audio_bytes: number;
    video_bytes: number;
  };
};
const body = async (who: "admin" | "me" | "other") =>
  (await (await get(who)).json()) as Body;
const itemIds = (b: Body) => b.groups.flatMap((g) => g.items.map((i) => i.id));

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "aqr-downloads-"));
  vi.stubEnv("AQR_REVIEW_DIR", dir);
  const { getDb } = await import("@/lib/db");
  const { createUser } = await import("@/lib/users");
  const { createLogin, authConfig } = await import("@/lib/auth");
  const { recordExport } = await import("@/lib/export-index");
  const { startVideoJob } = await import("@/lib/video-jobs");
  const db = getDb();
  const admin = createUser(db, { username: "admin1", passwordHash: "x" });
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
  const me = createUser(db, { username: "moi", passwordHash: "x" });
  const other = createUser(db, { username: "autre", passwordHash: "x" });
  const meta = db.prepare(
    `INSERT INTO session_meta (id, owner_id, name, original_name, visibility, created_at, updated_at, size_bytes, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'done')`,
  );
  meta.run(S_MINE1, me.id, "Mon audio", "a.wav", "private", T, T, 1000);
  meta.run(S_MINE2, me.id, "Mon autre audio", "c.wav", "private", T, T, 10);
  meta.run(S_THEIRS, other.id, "Leur audio", "b.wav", "private", T, T, 2000);
  meta.run(S_PUB, other.id, "Audio public", "d.wav", "global", T, T, 50);
  const video = (id: string, session: string, owner: number, bytes: number) =>
    recordExport(db, {
      id,
      sessionId: session,
      ownerId: owner,
      name: `${id}.mp4`,
      bytes,
      createdAt: T,
    });
  video("v1", S_MINE1, me.id, 400);
  video("v2", S_THEIRS, other.id, 700);
  video("v3", S_PUB, other.id, 90);
  cookies = {
    admin: createLogin(db, admin.id, authConfig()),
    me: createLogin(db, me.id, authConfig()),
    other: createLogin(db, other.id, authConfig()),
  };
  // Trois exports en file : deux pour « moi » (deux générations), un pour « autre ». Un seul s'exécute à la
  // fois : le premier tient la file, les suivants attendent.
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow = async (job: { dir: string; file: string | null }) => {
    await gate;
    job.file = path.join(job.dir, "v.mp4");
    await writeFile(job.file, "x");
  };
  const base = {
    options: {},
    background: null,
    credential: { bearer: "qtr_x" },
    origin: "http://127.0.0.1:3000",
    runner: slow,
  };
  ids.running = (
    await startVideoJob({ ...base, sessionId: S_MINE1, userId: me.id })
  ).id;
  ids.waiting = (
    await startVideoJob({ ...base, sessionId: S_MINE2, userId: me.id })
  ).id;
  ids.theirs = (
    await startVideoJob({ ...base, sessionId: S_THEIRS, userId: other.id })
  ).id;
  route = await import("./route");
  jobRoute = await import("../sessions/[id]/export/video/jobs/[job]/route");
});
afterAll(async () => {
  release();
  vi.unstubAllEnvs();
  const { closeDb } = await import("@/lib/db");
  closeDb();
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("GET /api/downloads", () => {
  it("sans connexion : 401", async () => {
    expect((await get(null)).status).toBe(401);
  });

  it("un compte reçoit ses générations et les publiques, regroupées, avec ses exports en file", async () => {
    const b = await body("me");
    expect(b.scope).toBe("mine");
    expect(b.groups.map((g) => g.session_id).sort()).toEqual([
      S_MINE1,
      S_MINE2,
      S_PUB,
    ]);
    const mine1 = b.groups.find((g) => g.session_id === S_MINE1);
    expect(mine1).toMatchObject({ mine: true, active: 1 });
    expect(mine1?.items.map((i) => i.id).sort()).toEqual(
      ["v1", ids.running].sort(),
    );
    expect(mine1?.items.find((i) => i.id === "v1")).toMatchObject({
      kind: "file",
      bytes: 400,
      can_delete: true,
      download_url: `/api/sessions/${S_MINE1}/videos/v1?download=1`,
    });
    expect(
      b.groups.find((g) => g.session_id === S_MINE2)?.items[0],
    ).toMatchObject({ kind: "job", state: "queued", can_cancel: true });
    expect(b.active).toBe(2);
  });

  it("NÉGATIF : ni la génération privée, ni les fichiers, ni les exports d'un autre compte ne fuient", async () => {
    const b = await body("me");
    const all = JSON.stringify(b);
    expect(itemIds(b)).not.toContain("v2");
    expect(itemIds(b)).not.toContain(ids.theirs);
    expect(all).not.toContain("Leur audio");
    expect(all).not.toContain(S_THEIRS);
  });

  it("une génération publique est visible, mais on n'y supprime ni n'y annule rien qui ne soit pas à soi", async () => {
    const b = await body("me");
    const pub = b.groups.find((g) => g.session_id === S_PUB);
    expect(pub?.owner_name).toBe("autre");
    expect(pub?.mine).toBe(false);
    expect(pub?.items).toHaveLength(1);
    expect(pub?.items[0]).toMatchObject({ id: "v3", can_delete: false });
  });

  it("l'administrateur voit toutes les générations, tous les exports, avec leur propriétaire", async () => {
    const b = await body("admin");
    expect(b.scope).toBe("all");
    expect(b.groups.map((g) => g.session_id).sort()).toEqual([
      S_MINE1,
      S_MINE2,
      S_THEIRS,
      S_PUB,
    ]);
    expect(itemIds(b)).toEqual(
      expect.arrayContaining([
        "v1",
        "v2",
        "v3",
        ids.running,
        ids.waiting,
        ids.theirs,
      ]),
    );
    expect(b.groups.find((g) => g.session_id === S_THEIRS)?.owner_name).toBe(
      "autre",
    );
    expect(b.active).toBe(3);
    expect(b.total_bytes).toBe(1190);
  });

  it("renvoie l'espace du compte (audio + vidéos gardées)", async () => {
    const b = await body("me");
    expect(b.quota).toMatchObject({
      audio_bytes: 1010,
      video_bytes: 400,
      used_bytes: 1410,
      limit_bytes: 2 * 1024 ** 3,
    });
  });
});

describe("annuler un export depuis la page", () => {
  const del = (who: "admin" | "me" | "other", session: string, job: string) =>
    jobRoute.DELETE(
      new Request(
        `http://127.0.0.1:3000/api/sessions/${session}/export/video/jobs/${job}`,
        {
          method: "DELETE",
          headers: {
            cookie: `aqr_session=${cookies[who]}`,
            origin: "http://127.0.0.1:3000",
          },
        },
      ),
      { params: Promise.resolve({ id: session, job }) },
    );

  it("NÉGATIF : un autre compte ne peut pas annuler mon export (404, il ignore même qu'il existe)", async () => {
    expect((await del("other", S_MINE2, ids.waiting)).status).toBe(404);
    expect(itemIds(await body("me"))).toContain(ids.waiting);
  });

  it("l'administrateur peut annuler l'export d'un compte ; il reste listé en échec « Export annulé. »", async () => {
    const response = await del("admin", S_MINE2, ids.waiting);
    expect(response.status).toBe(200);
    const after = await body("me");
    const item = after.groups
      .find((g) => g.session_id === S_MINE2)
      ?.items.find((i) => i.id === ids.waiting) as
      | (Item & { error?: string })
      | undefined;
    expect(item).toMatchObject({
      state: "failed",
      error: "Export annulé.",
      can_cancel: false,
    });
  });

  it("le lanceur annule son propre export", async () => {
    expect((await del("other", S_THEIRS, ids.theirs)).status).toBe(200);
  });
});
