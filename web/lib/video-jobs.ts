import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sessionDir } from "./store";
import {
  videoPrefsFromOptions,
  type VideoJobOptions,
} from "./video-job-options";

/**
 * Exports vidéo demandés par l'API. Le rendu se fait par le MÊME code que le formulaire de
 * l'atelier (canvas + WebCodecs), dans un navigateur sans interface lancé par le serveur : une
 * seule mise en page, aucun second moteur à maintenir. Le navigateur s'identifie avec le jeton de
 * l'appelant (jamais plus de droits que lui), télécharge le MP4, et le serveur le garde le temps
 * de le récupérer (une heure). Un rendu à la fois : c'est un travail lourd.
 */
export type VideoJobState = "queued" | "running" | "done" | "failed";

export type VideoJob = {
  id: string;
  sessionId: string;
  userId: number;
  state: VideoJobState;
  progress: string;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  options: VideoJobOptions;
  dir: string;
  file: string | null;
  background: string | null;
  /** Jeton de l'appelant, gardé en mémoire le temps du rendu seulement. */
  bearer: string | null;
  origin: string;
};

export type PublicVideoJob = Omit<
  VideoJob,
  "dir" | "file" | "background" | "bearer" | "origin" | "userId"
> & { download: string | null };

const RETENTION_MS = 60 * 60 * 1000;
const MAX_ACTIVE_PER_USER = 2;
const RENDER_TIMEOUT_MS = 30 * 60 * 1000;

const HOLDER = Symbol.for("aqr.video-jobs");
type Registry = { jobs: Map<string, VideoJob>; chain: Promise<void> };
function registry(): Registry {
  const holder = globalThis as { [HOLDER]?: Registry };
  return (holder[HOLDER] ??= { jobs: new Map(), chain: Promise.resolve() });
}

export class VideoJobLimitError extends Error {
  constructor() {
    super("Deux exports vidéo au plus en même temps : attends la fin de l'un.");
    this.name = "VideoJobLimitError";
  }
}

export class BrowserUnavailableError extends Error {
  constructor() {
    super(
      "Aucun navigateur Chrome ou Edge trouvé pour produire la vidéo : l'installer, ou renseigner AQR_CHROME.",
    );
    this.name = "BrowserUnavailableError";
  }
}

const CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

/** Navigateur à lancer : `AQR_CHROME`, sinon Chrome ou Edge installés (H.264 exige leurs codecs). */
export function browserExecutable(
  env: Record<string, string | undefined> = process.env,
  exists: (file: string) => boolean = existsSync,
): string | null {
  if (env.AQR_CHROME) return exists(env.AQR_CHROME) ? env.AQR_CHROME : null;
  return CANDIDATES.find((file) => exists(file)) ?? null;
}

export function publicJob(job: VideoJob): PublicVideoJob {
  const { dir, file, background, bearer, origin, userId, ...rest } = job;
  void dir;
  void background;
  void bearer;
  void origin;
  void userId;
  return {
    ...rest,
    download: job.state === "done" && file ? "file" : null,
  };
}

export function getVideoJob(id: string): VideoJob | null {
  return registry().jobs.get(id) ?? null;
}

async function purgeOld(): Promise<void> {
  const now = Date.now();
  for (const [id, job] of registry().jobs) {
    const age = now - Date.parse(job.finishedAt ?? job.createdAt);
    if (job.finishedAt && age > RETENTION_MS) {
      registry().jobs.delete(id);
      await rm(job.dir, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }
}

export async function startVideoJob(input: {
  sessionId: string;
  userId: number;
  options: VideoJobOptions;
  background: { bytes: Buffer; type: string } | null;
  bearer: string;
  origin: string;
  /** Remplace le rendu (tests). */
  runner?: (job: VideoJob) => Promise<void>;
}): Promise<VideoJob> {
  await purgeOld();
  const active = [...registry().jobs.values()].filter(
    (job) =>
      job.userId === input.userId &&
      (job.state === "queued" || job.state === "running"),
  );
  if (active.length >= MAX_ACTIVE_PER_USER) throw new VideoJobLimitError();
  if (!input.runner && !browserExecutable())
    throw new BrowserUnavailableError();
  const id = randomUUID();
  const dir = path.join(
    sessionDir(input.sessionId),
    "exports",
    `api-video-${id}`,
  );
  await mkdir(dir, { recursive: true });
  let background: string | null = null;
  if (input.background) {
    background = path.join(dir, "background");
    await writeFile(background, input.background.bytes);
  }
  const job: VideoJob = {
    id,
    sessionId: input.sessionId,
    userId: input.userId,
    state: "queued",
    progress: "En attente",
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    options: input.options,
    dir,
    file: null,
    background,
    bearer: input.bearer,
    origin: input.origin,
  };
  registry().jobs.set(id, job);
  const run = input.runner ?? renderInBrowser;
  const reg = registry();
  reg.chain = reg.chain.then(async () => {
    job.state = "running";
    job.progress = "Démarrage";
    try {
      await run(job);
      if (!job.file) throw new Error("Aucune vidéo produite.");
      job.state = "done";
      job.progress = "Terminé";
    } catch (error) {
      job.state = "failed";
      job.error = error instanceof Error ? error.message : "Rendu impossible.";
      job.progress = "Échec";
    } finally {
      job.bearer = null;
      job.finishedAt = new Date().toISOString();
    }
  });
  return job;
}

/** Rendu réel : page technique `/render/video` dans Chrome/Edge sans interface. */
async function renderInBrowser(job: VideoJob): Promise<void> {
  const executablePath = browserExecutable();
  if (!executablePath) throw new BrowserUnavailableError();
  const playwright = await import("playwright-core");
  const browser = await playwright.chromium.launch({
    executablePath,
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: job.bearer
        ? { authorization: `Bearer ${job.bearer}` }
        : {},
    });
    const page = await context.newPage();
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);
    const prefs = videoPrefsFromOptions(job.options, job.background !== null);
    await page.addInitScript(
      (payload) => {
        (window as unknown as { __AQR_RENDER: unknown }).__AQR_RENDER = payload;
      },
      {
        sessionId: job.sessionId,
        jobId: job.id,
        prefs,
        hasBackground: job.background !== null,
      },
    );
    const download = page.waitForEvent("download", {
      timeout: RENDER_TIMEOUT_MS,
    });
    const failure = page
      .waitForFunction(
        () =>
          (window as unknown as { __AQR_STATE?: { error?: string } })
            .__AQR_STATE?.error,
        undefined,
        { timeout: RENDER_TIMEOUT_MS },
      )
      .then(async (handle) => {
        throw new Error(String(await handle.jsonValue()));
      });
    const progress = setInterval(() => {
      page
        .evaluate(
          () =>
            (window as unknown as { __AQR_STATE?: { progress?: string } })
              .__AQR_STATE?.progress ?? "",
        )
        .then((text) => {
          if (text) job.progress = text;
        })
        .catch(() => undefined);
    }, 1500);
    try {
      await page.goto(`${job.origin}/render/video`, { waitUntil: "load" });
      const file = await Promise.race([download, failure]);
      const target = path.join(job.dir, "video.mp4");
      await file.saveAs(target);
      job.file = target;
    } finally {
      clearInterval(progress);
      // Évite un rejet non géré de l'autre branche de la course.
      failure.catch(() => undefined);
      download.catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
