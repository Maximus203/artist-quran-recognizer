import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  abortClip,
  cleanupExpiredClips,
  clipStatus,
  completeClip,
  createClip,
  listClips,
  purgeClips,
  READY_TTL_S,
  readyClip,
  receiveClipChunk,
  settledClip,
  touchClip,
  type ClipDeps,
} from "./background-video-store";
import { ClipRejected } from "./background-video-media";

/**
 * Vidéo de fond sur le serveur : envoi par morceaux, contrôle du type réel, préparation (muette, H.264),
 * propriété par compte ET par session, nettoyage. Les outils média (ffprobe, ffmpeg) sont simulés ici ;
 * la preuve avec les vrais se fait sur de vraies vidéos (voir le playbook).
 */
const CHUNK = 1024;
const SESSION = "11111111-1111-4111-8111-111111111111";
const OTHER_SESSION = "22222222-2222-4222-8222-222222222222";
let tmp = "";

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "aqr-clips-"));
  vi.stubEnv("AQR_REVIEW_DIR", tmp);
  vi.stubEnv("AQR_UPLOAD_CHUNK_BYTES", String(CHUNK));
  vi.stubEnv("AQR_MIN_UPLOAD_CHUNK_BYTES", "256");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmp, { recursive: true, force: true });
});

/** Un « MP4 » : la signature `ftyp` suffit à la reconnaissance du type, le reste est un remplissage. */
const mp4 = (size: number) =>
  Buffer.concat([
    Buffer.from([0, 0, 0, 0x18]),
    Buffer.from("ftypisom"),
    Buffer.from(
      Array.from({ length: size - 12 }, (_, i) => (i * 13 + 5) % 251),
    ),
  ]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const parts = (data: Buffer) =>
  Array.from({ length: Math.ceil(data.length / CHUNK) }, (_, i) =>
    data.subarray(i * CHUNK, (i + 1) * CHUNK),
  );

const deps = (over: Partial<ClipDeps> = {}): ClipDeps => ({
  sniff: undefined as never, // remplacé ci-dessous par le vrai
  probe: async () => ({
    duration: 12,
    width: 1920,
    height: 1080,
    codec: "h264",
  }),
  normalize: async ({ output, onRatio }) => {
    onRatio(0.5);
    await writeFile(output, Buffer.from("mp4-propre"));
    onRatio(1);
  },
  freeBytes: async () => null,
  now: () => Date.now(),
  ...over,
});
async function realSniff() {
  const { sniffFile } = await import("./import-session");
  return sniffFile;
}
async function withDeps(over: Partial<ClipDeps> = {}): Promise<ClipDeps> {
  return { ...deps(over), sniff: over.sniff ?? (await realSniff()) };
}

const owner = { sessionId: SESSION, ownerId: 1 };
const input = (over: Record<string, unknown> = {}) => ({
  ...owner,
  filename: "mer calme.mp4",
  size: CHUNK * 3 + 100,
  ...over,
});
const root = () => path.join(tmp, "background-videos");
const entries = async () => readdir(root()).catch(() => [] as string[]);

/** Crée, envoie tous les morceaux, assemble ; rend l'identifiant et le contenu. */
async function uploaded(
  d: ClipDeps,
  over: { data?: Buffer; ownerId?: number; sessionId?: string } = {},
) {
  const data = over.data ?? mp4(CHUNK * 3 + 100);
  const who = {
    sessionId: over.sessionId ?? SESSION,
    ownerId: over.ownerId ?? 1,
  };
  const created = await createClip(
    { ...who, filename: "mer calme.mp4", size: data.length },
    d,
  );
  for (const [index, body] of parts(data).entries())
    await receiveClipChunk({ ...who, id: created.id, index, body });
  return { id: created.id, data, who };
}

describe("création", () => {
  it("annonce les morceaux, les plafonds, et pose un dossier privé au nom choisi par le serveur", async () => {
    const created = await createClip(input(), await withDeps());
    expect(created).toMatchObject({ chunk_size: CHUNK, chunks: 4 });
    expect(created.id).toMatch(/^[0-9a-f]{32}$/);
    expect(created.limits.maxSeconds).toBeGreaterThan(0);
    expect(await entries()).toEqual([created.id]);
  });

  it("refuse un format inconnu, un fichier vide ou trop lourd, sans rien écrire", async () => {
    const d = await withDeps();
    await expect(
      createClip(input({ filename: "notes.txt" }), d),
    ).rejects.toMatchObject({ status: 400, code: "format" });
    await expect(createClip(input({ size: 0 }), d)).rejects.toMatchObject({
      status: 400,
      code: "empty",
    });
    vi.stubEnv("AQR_MAX_BACKGROUND_VIDEO_BYTES", "5000");
    await expect(createClip(input({ size: 6000 }), d)).rejects.toMatchObject({
      status: 413,
      code: "too_big",
    });
    expect(await entries()).toEqual([]);
  });

  it("ne garde de son nom que l'affichage : un chemin ou une extension piégée est écarté", async () => {
    const d = await withDeps();
    await expect(
      createClip(input({ filename: "../../etc/passwd" }), d),
    ).rejects.toMatchObject({ code: "format" });
    const created = await createClip(
      input({ filename: "..\\..\\dossier\\clip fdp.mp4" }),
      d,
    );
    const status = await clipStatus({ ...owner, id: created.id });
    expect(status.name).not.toMatch(/[\\/]/);
    expect(status.name.endsWith(".mp4")).toBe(true);
    const dir = await readdir(path.join(root(), created.id));
    expect(dir).toEqual(["meta.json"]);
  });

  it("refuse quand le disque n'a plus de place pour l'original et sa copie", async () => {
    const d = await withDeps({ freeBytes: async () => 10 * 1024 ** 2 });
    await expect(createClip(input(), d)).rejects.toMatchObject({
      status: 507,
      code: "disk_full",
    });
    expect(await entries()).toEqual([]);
  });

  it("limite le nombre de vidéos par compte, sans compter celles des autres ni celles qui ont échoué", async () => {
    vi.stubEnv("AQR_MAX_BACKGROUND_VIDEOS", "2");
    const d = await withDeps();
    await createClip(input(), d);
    await createClip(input(), d);
    await expect(createClip(input(), d)).rejects.toMatchObject({
      status: 409,
      code: "too_many",
    });
    // un autre compte a sa propre place
    await createClip(input({ ownerId: 2 }), d);
  });

  it("deux créations simultanées ne dépassent pas le plafond (pas de course)", async () => {
    vi.stubEnv("AQR_MAX_BACKGROUND_VIDEOS", "1");
    const d = await withDeps();
    const results = await Promise.allSettled([
      createClip(input(), d),
      createClip(input(), d),
      createClip(input(), d),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await entries()).toHaveLength(1);
  });
});

describe("morceaux, reprise et état", () => {
  it("reçoit dans le désordre, dit ce qui manque, accepte de renvoyer un morceau", async () => {
    const d = await withDeps();
    const data = mp4(CHUNK * 3 + 100);
    const created = await createClip(input({ size: data.length }), d);
    const p = parts(data);
    await receiveClipChunk({ ...owner, id: created.id, index: 2, body: p[2] });
    await receiveClipChunk({ ...owner, id: created.id, index: 0, body: p[0] });
    await receiveClipChunk({ ...owner, id: created.id, index: 0, body: p[0] });
    const state = await clipStatus({ ...owner, id: created.id });
    expect(state).toMatchObject({ state: "uploading", received: [0, 2] });
  });

  it("refuse un morceau de taille inattendue", async () => {
    const d = await withDeps();
    const created = await createClip(input(), d);
    await expect(
      receiveClipChunk({
        ...owner,
        id: created.id,
        index: 0,
        body: Buffer.alloc(10),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("un autre compte, ou une autre session, ne voit rien : « inconnu », jamais « interdit »", async () => {
    const d = await withDeps();
    const created = await createClip(input(), d);
    const body = Buffer.alloc(CHUNK);
    for (const who of [
      { sessionId: SESSION, ownerId: 2 },
      { sessionId: OTHER_SESSION, ownerId: 1 },
    ]) {
      await expect(
        clipStatus({ ...who, id: created.id }),
      ).rejects.toMatchObject({ status: 404, code: "missing" });
      await expect(
        receiveClipChunk({ ...who, id: created.id, index: 0, body }),
      ).rejects.toMatchObject({ status: 404 });
      await expect(abortClip({ ...who, id: created.id })).rejects.toMatchObject(
        { status: 404 },
      );
      await expect(
        completeClip({ ...who, id: created.id }, d),
      ).rejects.toMatchObject({ status: 404 });
      await expect(readyClip({ ...who, id: created.id })).rejects.toMatchObject(
        { status: 404 },
      );
    }
    expect(await entries()).toEqual([created.id]); // rien n'a été supprimé par ces tentatives
  });

  it("un identifiant qui n'est pas 32 caractères hexadécimaux est refusé avant tout accès au disque", async () => {
    for (const id of [
      "../..",
      "..",
      "a/b",
      "A".repeat(32),
      "",
      "zz".repeat(16),
    ])
      await expect(clipStatus({ ...owner, id })).rejects.toMatchObject({
        status: 404,
      });
  });

  it("la liste ne montre que les vidéos de CE compte pour CETTE session", async () => {
    const d = await withDeps();
    await createClip(input(), d);
    await createClip(input({ ownerId: 2 }), d);
    await createClip(input({ sessionId: OTHER_SESSION }), d);
    expect(await listClips(owner)).toHaveLength(1);
  });
});

describe("assemblage, contrôle du type réel et préparation", () => {
  it("assemble, prépare une copie muette, garde l'empreinte de l'original et supprime morceaux et original", async () => {
    const d = await withDeps();
    const { id, data } = await uploaded(d);
    const done = await completeClip({ ...owner, id }, d);
    expect(done.state).toBe("processing");
    await settledClip(id);
    const status = await clipStatus({ ...owner, id });
    expect(status).toMatchObject({
      state: "ready",
      duration: 12,
      width: 1920,
      height: 1080,
      ratio: 1,
    });
    const ready = await readyClip({ ...owner, id });
    expect(ready.sha256).toBe(sha(data));
    expect(ready.size).toBe((await stat(ready.path)).size);
    expect(path.basename(ready.path)).toBe("video.mp4");
    // un seul fichier de vidéo reste : la copie préparée (plus de morceaux ni d'original)
    expect((await readdir(path.join(root(), id))).sort()).toEqual([
      "meta.json",
      "video.mp4",
    ]);
  });

  it("l'original est lu octet pour octet par la préparation", async () => {
    let seen: Buffer | null = null;
    const d = await withDeps({
      normalize: async ({ source, output }) => {
        seen = await readFile(source);
        await writeFile(output, "x");
      },
    });
    const { id, data } = await uploaded(d);
    await completeClip({ ...owner, id }, d);
    await settledClip(id);
    expect(seen).not.toBeNull();
    expect(sha(seen as unknown as Buffer)).toBe(sha(data));
  });

  it("il manque un morceau : 409 avec le compte, rien n'est supprimé, on peut reprendre", async () => {
    const d = await withDeps();
    const data = mp4(CHUNK * 3 + 100);
    const created = await createClip(input({ size: data.length }), d);
    const p = parts(data);
    await receiveClipChunk({ ...owner, id: created.id, index: 0, body: p[0] });
    await expect(
      completeClip({ ...owner, id: created.id }, d),
    ).rejects.toMatchObject({ status: 409 });
    for (const i of [1, 2, 3])
      await receiveClipChunk({
        ...owner,
        id: created.id,
        index: i,
        body: p[i],
      });
    expect((await completeClip({ ...owner, id: created.id }, d)).state).toBe(
      "processing",
    );
    await settledClip(created.id);
  });

  it("refuse un fichier dont le contenu n'est pas une vidéo (page HTML nommée .mp4) et supprime tout", async () => {
    const d = await withDeps();
    const html = Buffer.concat([
      Buffer.from("<html><body>pas une vidéo</body></html>"),
      Buffer.alloc(CHUNK * 2),
    ]);
    const { id } = await uploaded(d, { data: html });
    await expect(completeClip({ ...owner, id }, d)).rejects.toMatchObject({
      status: 415,
      code: "format",
    });
    expect(await entries()).toEqual([]);
  });

  it("refuse un audio qui porterait une extension vidéo (MP3 nommé .mp4)", async () => {
    const d = await withDeps();
    const mp3 = Buffer.concat([
      Buffer.from("ID3\u0003\u0000\u0000\u0000\u0000\u0000\u0000"),
      Buffer.alloc(CHUNK * 2),
    ]);
    const { id } = await uploaded(d, { data: mp3 });
    await expect(completeClip({ ...owner, id }, d)).rejects.toMatchObject({
      status: 415,
    });
    expect(await entries()).toEqual([]);
  });

  it("refuse un fichier sans image, abîmé ou trop long, avec la bonne raison, et supprime tout", async () => {
    const cases: Array<[ClipRejected, number, string]> = [
      [new ClipRejected("no_video"), 422, "no_video"],
      [new ClipRejected("unreadable"), 422, "unreadable"],
    ];
    for (const [error, status, code] of cases) {
      const d = await withDeps({
        probe: async () => {
          throw error;
        },
      });
      const { id } = await uploaded(d);
      await expect(completeClip({ ...owner, id }, d)).rejects.toMatchObject({
        status,
        code,
      });
      expect(await entries()).toEqual([]);
    }
    vi.stubEnv("AQR_MAX_BACKGROUND_VIDEO_SECONDS", "60");
    const long = await withDeps({
      probe: async () => ({
        duration: 90,
        width: 640,
        height: 360,
        codec: "h264",
      }),
    });
    const { id } = await uploaded(long);
    await expect(completeClip({ ...owner, id }, long)).rejects.toMatchObject({
      status: 413,
      code: "too_long",
    });
    expect(await entries()).toEqual([]);
  });

  it("des images démesurées (bombe de décompression) sont refusées avant toute préparation", async () => {
    let prepared = false;
    const d = await withDeps({
      probe: async () => ({
        duration: 5,
        width: 20000,
        height: 12000,
        codec: "h264",
      }),
      normalize: async () => {
        prepared = true;
      },
    });
    const { id } = await uploaded(d);
    await expect(completeClip({ ...owner, id }, d)).rejects.toMatchObject({
      status: 413,
      code: "too_wide",
    });
    expect(prepared).toBe(false);
    expect(await entries()).toEqual([]);
  });

  it("un marqueur d'assemblage resté après une panne (plus de 10 min) ne bloque pas la reprise", async () => {
    const d = await withDeps();
    const { id } = await uploaded(d);
    const marker = path.join(root(), id, "completing");
    await writeFile(marker, "");
    // frais : un autre assemblage est vraiment en cours
    await expect(completeClip({ ...owner, id }, d)).rejects.toMatchObject({
      status: 409,
    });
    const old = new Date(Date.now() - 11 * 60_000);
    await utimes(marker, old, old);
    expect((await completeClip({ ...owner, id }, d)).state).toBe("processing");
    await settledClip(id);
  });

  it("une empreinte annoncée qui ne correspond pas est refusée et tout est supprimé", async () => {
    const d = await withDeps();
    const { id } = await uploaded(d);
    await expect(
      completeClip({ ...owner, id }, d, { sha256: "0".repeat(64) }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await entries()).toEqual([]);
  });

  it("une empreinte correcte passe", async () => {
    const d = await withDeps();
    const { id, data } = await uploaded(d);
    const done = await completeClip({ ...owner, id }, d, { sha256: sha(data) });
    expect(done.state).toBe("processing");
    await settledClip(id);
  });

  it("une préparation qui échoue : état « échec » expliqué, l'original est supprimé, la vidéo n'est pas servie", async () => {
    const d = await withDeps({
      normalize: async () => {
        throw new Error("ffmpeg a échoué (code 1) : Invalid data found");
      },
    });
    const { id } = await uploaded(d);
    await completeClip({ ...owner, id }, d);
    await settledClip(id);
    const status = await clipStatus({ ...owner, id });
    expect(status.state).toBe("failed");
    expect(status.failure).toBe("unreadable");
    expect(status.message).not.toMatch(/ffmpeg|Invalid data/i);
    await expect(readyClip({ ...owner, id })).rejects.toMatchObject({
      status: 422,
    });
    expect(await readdir(path.join(root(), id))).toEqual(["meta.json"]);
  });

  it("une vidéo dont la durée n'était pas connue et qui dépasse le plafond une fois préparée échoue « trop longue »", async () => {
    vi.stubEnv("AQR_MAX_BACKGROUND_VIDEO_SECONDS", "60");
    let calls = 0;
    const d = await withDeps({
      probe: async () => {
        calls += 1;
        return calls === 1
          ? { duration: null, width: 640, height: 360, codec: "vp9" }
          : { duration: 61, width: 640, height: 360, codec: "h264" };
      },
    });
    const { id } = await uploaded(d);
    await completeClip({ ...owner, id }, d);
    await settledClip(id);
    expect(await clipStatus({ ...owner, id })).toMatchObject({
      state: "failed",
      failure: "too_long",
    });
  });

  it("une durée trouvée seulement après la préparation (WebM de MediaRecorder) est gardée", async () => {
    let calls = 0;
    const d = await withDeps({
      probe: async () => {
        calls += 1;
        return calls === 1
          ? { duration: null, width: 640, height: 360, codec: "vp8" }
          : { duration: 7.3, width: 640, height: 360, codec: "h264" };
      },
    });
    const { id } = await uploaded(d);
    await completeClip({ ...owner, id }, d);
    await settledClip(id);
    expect(await clipStatus({ ...owner, id })).toMatchObject({
      state: "ready",
      duration: 7.3,
    });
  });

  it("assembler deux fois en même temps : le second est refusé ; une fois prête, redemander rend l'état (réponse perdue)", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const d = await withDeps({
      probe: async () => {
        await gate;
        return { duration: 5, width: 640, height: 360, codec: "h264" };
      },
    });
    const { id } = await uploaded(d);
    const first = completeClip({ ...owner, id }, d);
    await expect(completeClip({ ...owner, id }, d)).rejects.toMatchObject({
      status: 409,
    });
    release();
    await first;
    await settledClip(id);
    expect((await completeClip({ ...owner, id }, d)).state).toBe("ready");
  });

  it("la préparation passe une par une (une seule ffmpeg à la fois sur un serveur à 2 cœurs)", async () => {
    let active = 0;
    let peak = 0;
    const d = await withDeps({
      normalize: async ({ output }) => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 20));
        await writeFile(output, "x");
        active -= 1;
      },
    });
    const a = await uploaded(d);
    const b = await uploaded(d);
    await Promise.all([
      completeClip({ ...owner, id: a.id }, d),
      completeClip({ ...owner, id: b.id }, d),
    ]);
    await Promise.all([settledClip(a.id), settledClip(b.id)]);
    expect(peak).toBe(1);
  });

  it("une vidéo en préparation n'est pas servie : « pas prête »", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const d = await withDeps({
      normalize: async ({ output }) => {
        await gate;
        await writeFile(output, "x");
      },
    });
    const { id } = await uploaded(d);
    await completeClip({ ...owner, id }, d);
    await expect(readyClip({ ...owner, id })).rejects.toMatchObject({
      status: 409,
      code: "not_ready",
    });
    release();
    await settledClip(id);
    expect((await readyClip({ ...owner, id })).path).toContain("video.mp4");
  });

  it("après un redémarrage (rien en mémoire), une vidéo « en préparation » repart toute seule à la lecture de son état", async () => {
    const d = await withDeps();
    const { id } = await uploaded(d);
    await completeClip({ ...owner, id }, d);
    await settledClip(id);
    // simule le redémarrage : l'état sur disque dit « en préparation » et l'original est encore là
    const meta = JSON.parse(
      await readFile(path.join(root(), id, "meta.json"), "utf8"),
    );
    await writeFile(
      path.join(root(), id, "meta.json"),
      JSON.stringify({ ...meta, state: "processing" }),
    );
    await rm(path.join(root(), id, "video.mp4"));
    await writeFile(path.join(root(), id, "original.mp4"), mp4(CHUNK + 50));
    const status = await clipStatus({ ...owner, id }, d);
    expect(status.state).toBe("processing");
    await settledClip(id);
    expect((await clipStatus({ ...owner, id }, d)).state).toBe("ready");
  });
});

describe("abandon et suppression", () => {
  it("supprime tout ce qui a été reçu", async () => {
    const d = await withDeps();
    const { id } = await uploaded(d);
    await abortClip({ ...owner, id });
    expect(await entries()).toEqual([]);
    await expect(clipStatus({ ...owner, id })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("arrête la préparation en cours et supprime la vidéo", async () => {
    let aborted = false;
    let started: () => void = () => undefined;
    const running = new Promise<void>((resolve) => (started = resolve));
    const d = await withDeps({
      normalize: async ({ signal }) => {
        await new Promise<void>((resolve) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            resolve();
          });
          started();
        });
        throw new Error("tué");
      },
    });
    const { id } = await uploaded(d);
    await completeClip({ ...owner, id }, d);
    await running; // la préparation tourne vraiment
    await abortClip({ ...owner, id });
    await settledClip(id);
    expect(aborted).toBe(true);
    expect(await entries()).toEqual([]);
  });

  it("supprimer une vidéo encore en attente derrière une autre : elle n'est jamais préparée", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const prepared: string[] = [];
    const d = await withDeps({
      normalize: async ({ source, output }) => {
        prepared.push(path.basename(path.dirname(source)));
        await gate;
        await writeFile(output, "x");
      },
    });
    const a = await uploaded(d);
    const b = await uploaded(d);
    await completeClip({ ...owner, id: a.id }, d);
    await completeClip({ ...owner, id: b.id }, d);
    await abortClip({ ...owner, id: b.id });
    release();
    await settledClip(a.id);
    await settledClip(b.id);
    expect(prepared).toEqual([a.id]);
    expect(await entries()).toEqual([a.id]);
  });

  it("supprimer une vidéo prête la rend introuvable", async () => {
    const d = await withDeps();
    const { id } = await uploaded(d);
    await completeClip({ ...owner, id }, d);
    await settledClip(id);
    await abortClip({ ...owner, id });
    await expect(readyClip({ ...owner, id })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("nettoyage : session, compte, expiration", () => {
  it("la suppression d'une session retire ses vidéos de fond, et seulement les siennes", async () => {
    const d = await withDeps();
    const a = await uploaded(d);
    const b = await uploaded(d, { sessionId: OTHER_SESSION });
    expect(await purgeClips({ sessionId: SESSION })).toBe(1);
    expect(await entries()).toEqual([b.id]);
    expect(a.id).not.toBe(b.id);
  });

  it("la suppression d'un compte retire toutes ses vidéos, sur toutes ses sessions", async () => {
    const d = await withDeps();
    await uploaded(d, { ownerId: 1 });
    await uploaded(d, { ownerId: 1, sessionId: OTHER_SESSION });
    const keep = await uploaded(d, { ownerId: 2 });
    expect(await purgeClips({ ownerId: 1 })).toBe(2);
    expect(await entries()).toEqual([keep.id]);
  });

  it("purger sans critère ne supprime rien (garde-fou)", async () => {
    const d = await withDeps();
    await uploaded(d);
    expect(await purgeClips({})).toBe(0);
    expect(await entries()).toHaveLength(1);
  });

  it("l'expiration dépend de l'état : un envoi abandonné après 24 h, une vidéo prête après son délai sans usage, un échec après 1 h", async () => {
    const t0 = Date.now();
    const d = await withDeps({ now: () => t0 });
    const abandoned = await createClip(input(), d);
    const ready = await uploaded(d);
    await completeClip({ ...owner, id: ready.id }, d);
    await settledClip(ready.id);
    const bad = await withDeps({
      normalize: async () => {
        throw new Error("x");
      },
      now: () => t0,
    });
    const failed = await uploaded(bad);
    await completeClip({ ...owner, id: failed.id }, bad);
    await settledClip(failed.id);

    expect(await cleanupExpiredClips(t0 + 60_000)).toBe(0);
    expect(await cleanupExpiredClips(t0 + 2 * 3600_000)).toBe(1); // l'échec
    expect(await entries()).toContain(abandoned.id);
    expect(await cleanupExpiredClips(t0 + 25 * 3600_000)).toBe(1); // l'envoi abandonné
    expect(await entries()).toEqual([ready.id]);
    expect(await cleanupExpiredClips(t0 + (READY_TTL_S + 60) * 1000)).toBe(1);
    expect(await entries()).toEqual([]);
  });

  it("l'usage d'une vidéo prête repousse son expiration", async () => {
    const t0 = Date.now();
    const d = await withDeps({ now: () => t0 });
    const { id } = await uploaded(d);
    await completeClip({ ...owner, id }, d);
    await settledClip(id);
    const later = t0 + (READY_TTL_S - 600) * 1000;
    await touchClip({ ...owner, id }, later);
    expect(await cleanupExpiredClips(t0 + (READY_TTL_S + 60) * 1000)).toBe(0);
  });

  it("un dossier sans méta lisible, vieux de plus de 24 h, est retiré ; un dossier étranger au format d'identifiant est laissé", async () => {
    await mkdir(path.join(root(), "a".repeat(32)), { recursive: true });
    await mkdir(path.join(root(), "notes"), { recursive: true });
    expect(await cleanupExpiredClips(Date.now() + 25 * 3600_000)).toBe(1);
    expect(await entries()).toEqual(["notes"]);
  });
});
