import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ root: "" }));
vi.mock("./store", () => ({
  sessionDir: (id: string) => path.join(mocks.root, id),
}));

import {
  applyRenderState,
  browserExecutable,
  getVideoJob,
  publicJob,
  startVideoJob,
  VideoJobLimitError,
  type VideoJob,
} from "./video-jobs";
import {
  suggestOptionsFromQuery,
  videoJobOptionsSchema,
  videoOptionsCatalog,
  videoPrefsFromOptions,
} from "./video-job-options";

beforeAll(async () => {
  mocks.root = await mkdtemp(path.join(os.tmpdir(), "aqr-vjobs-"));
});
afterAll(async () => {
  await rm(mocks.root, { recursive: true, force: true });
});

const base = {
  sessionId: "s1",
  userId: 1,
  options: {},
  background: null,
  bearer: "qtr_x",
  origin: "http://127.0.0.1:3000",
};

async function settle(id: string): Promise<VideoJob> {
  for (let i = 0; i < 200; i++) {
    const job = getVideoJob(id) as VideoJob;
    if (job.state === "done" || job.state === "failed") return job;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("job jamais terminé");
}

describe("options de l'export vidéo par l'API", () => {
  it("accepte les réglages du formulaire et refuse le reste", () => {
    expect(
      videoJobOptionsSchema.safeParse({
        orientation: "9:16",
        arabic_size: "large",
        translation_size: 38,
        show_translation: false,
        background: "desert-dunes",
      }).success,
    ).toBe(true);
    for (const bad of [
      { orientation: "4:3" },
      { arabic_size: 500 },
      { arabic_size: "huge" },
      { background: "inconnu" },
      { color: "rouge" },
      { surprise: true },
    ])
      expect(videoJobOptionsSchema.safeParse(bad).success).toBe(false);
  });

  it("accepte cadence, résolution et plages ; refuse les valeurs hors liste", () => {
    expect(
      videoJobOptionsSchema.safeParse({
        fps: 60,
        resolution: 2160,
        ranges: [
          { start: 0, end: 12.5 },
          { start: 30, end: 41 },
        ],
      }).success,
    ).toBe(true);
    expect(videoJobOptionsSchema.safeParse({ per_verse: true }).success).toBe(
      true,
    );
    for (const bad of [
      { fps: 24 },
      { fps: 120 },
      { resolution: 1000 },
      { ranges: [] },
      { ranges: [{ start: 10, end: 10.1 }] },
      { ranges: [{ start: -1, end: 5 }] },
      { ranges: [{ start: 0, end: 5, extra: 1 }] },
      { ranges: [{ start: 0, end: 5 }], per_verse: true },
    ])
      expect(videoJobOptionsSchema.safeParse(bad).success).toBe(false);
  });

  it("accepte un nom par plage (suffixe du fichier) ; refuse un nom vide ou trop long", () => {
    expect(
      videoJobOptionsSchema.safeParse({
        ranges: [
          { start: 0, end: 5, name: "2:255" },
          { start: 6, end: 9 },
        ],
      }).success,
    ).toBe(true);
    for (const name of ["", "   ", "x".repeat(81)])
      expect(
        videoJobOptionsSchema.safeParse({
          ranges: [{ start: 0, end: 5, name }],
        }).success,
      ).toBe(false);
  });

  it("accepte la découpe automatique protégée et ses marges ; refuse les valeurs absurdes", () => {
    expect(
      videoJobOptionsSchema.safeParse({
        suggest: "passage",
        lead_in: 1.2,
        tail_out: 0.8,
        snap_to_silence: false,
        merge_gap: 2,
      }).success,
    ).toBe(true);
    expect(
      videoJobOptionsSchema.safeParse({
        ranges: [{ start: 1, end: 9 }],
        pad_ranges: true,
        lead_in: 1,
      }).success,
    ).toBe(true);
    for (const bad of [
      { suggest: "chapitre" },
      { lead_in: -1 },
      { lead_in: 99 },
      { tail_out: 6 },
      { merge_gap: 100 },
      { suggest: "verse", ranges: [{ start: 0, end: 5 }] },
    ])
      expect(videoJobOptionsSchema.safeParse(bad).success).toBe(false);
  });

  it("lit les paramètres de la route de suggestions et applique les défauts", () => {
    const ok = suggestOptionsFromQuery(
      new URLSearchParams("lead_in=1&snap=0&group=passage"),
    );
    expect(ok).toMatchObject({
      ok: true,
      options: {
        leadIn: 1,
        tailOut: 0.4,
        snapToSilence: false,
        group: "passage",
      },
    });
    expect(suggestOptionsFromQuery(new URLSearchParams("")).ok).toBe(true);
    for (const query of ["lead_in=abc", "tail_out=9", "group=chapitre"])
      expect(suggestOptionsFromQuery(new URLSearchParams(query)).ok).toBe(
        false,
      );
  });

  it("reporte cadence et résolution dans les réglages du rendu (défauts 30 et 1080)", () => {
    const prefs = videoPrefsFromOptions({ fps: 60, resolution: 720 }, false);
    expect(prefs.fps).toBe(60);
    expect(prefs.resolution).toBe(720);
    const defaults = videoPrefsFromOptions({}, false);
    expect(defaults.fps).toBe(30);
    expect(defaults.resolution).toBe(1080);
  });

  it("traduit les noms de taille et applique les défauts du formulaire", () => {
    const prefs = videoPrefsFromOptions(
      { arabic_size: "xlarge", translation_size: "small" },
      false,
    );
    expect(prefs.arabicSize).toBe(120);
    expect(prefs.translationSize).toBe(24);
    expect(prefs.orientation).toBe("16:9");
    expect(prefs.showTranslation).toBe(true);
    expect(prefs.background).toBeNull();
  });

  it("couvre les options de remplissage, de hauteur, d'onde, d'accent et de nom", () => {
    const accent = { h: 40, s: 80, l: 60, a: 1 };
    const options = videoJobOptionsSchema.parse({
      fill: true,
      text_position: "top",
      show_wave: false,
      accent,
      file_name: "ma-video",
      arabic_size: 200,
    });
    const prefs = videoPrefsFromOptions(options, false);
    expect(prefs.fill).toBe(true);
    expect(prefs.textPosition).toBe(12);
    expect(prefs.showWave).toBe(false);
    expect(prefs.accent).toEqual(accent);
    expect(prefs.arabicSize).toBe(200);
    expect(
      videoJobOptionsSchema.safeParse({ accent: { h: 400, s: 1, l: 50, a: 1 } })
        .success,
    ).toBe(false);
    expect(
      videoJobOptionsSchema.safeParse({ text_position: 150 }).success,
    ).toBe(false);
    expect(
      videoPrefsFromOptions({ text_position: 30 }, false).textPosition,
    ).toBe(30);
  });

  it("une image envoyée l'emporte sur le fond choisi", () => {
    expect(
      videoPrefsFromOptions({ background: "desert-dunes" }, true).background,
    ).toBeNull();
    expect(
      videoPrefsFromOptions({ background: "desert-dunes" }, false).background,
    ).toBe("desert-dunes");
  });

  it("publie un catalogue complet (formats, tailles, fonds)", () => {
    const catalog = videoOptionsCatalog();
    expect(catalog.orientation).toContain("9:16");
    expect(catalog.background.ids).toContain("mosquee-crepuscule");
    expect(catalog.arabic_size.names).toMatchObject({ medium: 72 });
  });
});

describe("jobs d'export vidéo", () => {
  it("exécute le rendu, garde le fichier et oublie le jeton", async () => {
    const job = await startVideoJob({
      ...base,
      runner: async (j) => {
        j.file = path.join(j.dir, "video.mp4");
        await writeFile(j.file, "mp4");
      },
    });
    const done = await settle(job.id);
    expect(done.state).toBe("done");
    expect(await readFile(done.file as string, "utf8")).toBe("mp4");
    expect(done.bearer).toBeNull();
    expect(JSON.stringify(publicJob(done))).not.toContain("qtr_x");
    expect(publicJob(done).download).toBe("file");
  });

  it("rapporte une erreur lisible sans planter", async () => {
    const job = await startVideoJob({
      ...base,
      runner: async () => {
        throw new Error("Aucun passage coranique avec texte.");
      },
    });
    const done = await settle(job.id);
    expect(done.state).toBe("failed");
    expect(done.error).toMatch(/Aucun passage/);
    expect(publicJob(done).download).toBeNull();
  });

  it("limite à deux exports actifs par compte", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async (j: VideoJob) => {
      await gate;
      j.file = path.join(j.dir, "v.mp4");
      await writeFile(j.file, "x");
    };
    const a = await startVideoJob({ ...base, userId: 7, runner: slow });
    const b = await startVideoJob({ ...base, userId: 7, runner: slow });
    await expect(
      startVideoJob({ ...base, userId: 7, runner: slow }),
    ).rejects.toBeInstanceOf(VideoJobLimitError);
    // un autre compte n'est pas gêné
    const c = await startVideoJob({ ...base, userId: 8, runner: slow });
    release();
    for (const j of [a, b, c]) expect((await settle(j.id)).state).toBe("done");
  });
});

describe("pile unique avec les analyses", () => {
  it("un export vidéo attend la fin d'une analyse (une seule charge à la fois)", async () => {
    const { jobQueue } = await import("./jobs");
    let release: () => void = () => undefined;
    const analysis = new Promise<void>((r) => (release = r));
    const queue = jobQueue();
    queue.enqueue("analyse-test", {
      run: async (_id, signal) => {
        signal.started();
        await analysis;
      },
    });
    const job = await startVideoJob({
      ...base,
      userId: 91,
      runner: async (j) => {
        j.file = path.join(j.dir, "v.mp4");
        await writeFile(j.file, "x");
      },
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(getVideoJob(job.id)?.state).toBe("queued");
    release();
    expect((await settle(job.id)).state).toBe("done");
  });
});

describe("avancement d'un job, fichier par fichier", () => {
  it("publie progress, files_done et files_total ; tout est fait à la fin", async () => {
    const job = await startVideoJob({
      ...base,
      userId: 41,
      runner: async (j) => {
        applyRenderState(j, {
          progress: "Vidéo 2/3 : rendu 64 %",
          files_done: 1,
          files_total: 3,
        });
        expect(publicJob(j)).toMatchObject({
          progress: "Vidéo 2/3 : rendu 64 %",
          files_done: 1,
          files_total: 3,
        });
        const files = [0, 1, 2].map((n) => path.join(j.dir, `v${n}.mp4`));
        for (const f of files) await writeFile(f, "x");
        j.files = files.map((f) => ({ name: path.basename(f), path: f }));
        j.file = files[0];
      },
    });
    const done = await settle(job.id);
    expect(publicJob(done)).toMatchObject({
      state: "done",
      files_done: 3,
      files_total: 3,
    });
  });
  it("un état partiel ne remet rien à zéro", () => {
    const job = { progress: "x", files_done: 2, files_total: 4 } as VideoJob;
    applyRenderState(job, {});
    expect(job).toMatchObject({ progress: "x", files_done: 2, files_total: 4 });
  });
});

describe("navigateur de rendu", () => {
  it("préfère AQR_CHROME, sinon Chrome ou Edge installés", () => {
    expect(browserExecutable({ AQR_CHROME: "/x/chrome" }, () => true)).toBe(
      "/x/chrome",
    );
    expect(
      browserExecutable({ AQR_CHROME: "/x/absent" }, () => false),
    ).toBeNull();
    expect(
      browserExecutable({}, (f) => f.toLowerCase().includes("msedge")),
    ).toMatch(/msedge/i);
    expect(browserExecutable({}, () => false)).toBeNull();
  });
});
