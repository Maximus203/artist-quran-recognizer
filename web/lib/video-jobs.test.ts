import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ root: "" }));
vi.mock("./store", () => ({
  sessionDir: (id: string) => path.join(mocks.root, id),
}));

import {
  browserExecutable,
  getVideoJob,
  publicJob,
  startVideoJob,
  VideoJobLimitError,
  type VideoJob,
} from "./video-jobs";
import {
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
