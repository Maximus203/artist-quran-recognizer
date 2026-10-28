import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { sessionDir } from "./store";
import {
  suggestOptionsOf,
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
  /** « Vidéo 2/5 : rendu 64 % » : lisible tel quel par un humain ou un agent. */
  progress: string;
  /** Vidéos déjà produites et nombre attendu (connu une fois les plages calculées). */
  files_done: number;
  files_total: number | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  options: VideoJobOptions;
  dir: string;
  /** Premier MP4 (le seul sans plages) ; tous les MP4, dans l'ordre des plages, sont dans `files`. */
  file: string | null;
  files: { name: string; path: string }[];
  background: string | null;
  /** Jeton de l'appelant, gardé en mémoire le temps du rendu seulement. */
  bearer: string | null;
  origin: string;
};

export type PublicVideoJob = Omit<
  VideoJob,
  "dir" | "file" | "files" | "background" | "bearer" | "origin" | "userId"
> & {
  download: string | null;
  /** Un fichier par plage (même ordre que les plages) ; `url` est relative au job. */
  downloads: { index: number; name: string; url: string }[];
};

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
  const { dir, file, files, background, bearer, origin, userId, ...rest } = job;
  void dir;
  void background;
  void bearer;
  void origin;
  void userId;
  return {
    ...rest,
    download: job.state === "done" && file ? "file" : null,
    downloads:
      job.state === "done"
        ? files.map((f, index) => ({
            index,
            name: f.name,
            url: index === 0 ? "file" : `file?index=${index}`,
          }))
        : [],
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
    files_done: 0,
    files_total: null,
    error: null,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    options: input.options,
    dir,
    file: null,
    files: [],
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
      if (job.files.length === 0)
        job.files = [{ name: path.basename(job.file), path: job.file }];
      job.state = "done";
      job.progress = "Terminé";
      job.files_done = job.files.length;
      job.files_total = job.files.length;
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

/** État publié par la page de rendu (`window.__AQR_STATE`). */
export type RenderPageState = {
  progress?: string;
  files_done?: number;
  files_total?: number;
};

/** Reporte l'avancement lu dans la page de rendu sur le job (champs absents : inchangés). */
export function applyRenderState(job: VideoJob, state: RenderPageState): void {
  if (state.progress) job.progress = state.progress;
  if (typeof state.files_total === "number") job.files_total = state.files_total;
  if (typeof state.files_done === "number") job.files_done = state.files_done;
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
        fileName: job.options.file_name,
        ranges: job.options.ranges,
        perVerse: job.options.per_verse === true,
        suggest: job.options.suggest,
        margins: suggestOptionsOf(job.options),
        padRanges: job.options.pad_ranges === true,
        prefs,
        hasBackground: job.background !== null,
      },
    );
    // Chaque MP4 produit (un par plage) arrive comme un téléchargement : on les enregistre au fil de l'eau.
    const saves: Promise<void>[] = [];
    page.on("download", (file) => {
      const n = saves.length;
      const target = path.join(job.dir, `video-${n}.mp4`);
      saves.push(
        file.saveAs(target).then(() => {
          job.files[n] = { name: file.suggestedFilename(), path: target };
        }),
      );
    });
    type RenderState = { error?: string; done?: boolean; total?: number };
    const finished = page
      .waitForFunction(
        () => {
          const state = (window as unknown as { __AQR_STATE?: RenderState })
            .__AQR_STATE;
          return state?.error || state?.done ? state : null;
        },
        undefined,
        { timeout: RENDER_TIMEOUT_MS, polling: 500 },
      )
      .then(async (handle) => {
        const state = (await handle.jsonValue()) as RenderState;
        if (state.error) throw new Error(state.error);
        return state;
      });
    const progress = setInterval(() => {
      page
        .evaluate(() => {
          const state = (window as unknown as { __AQR_STATE?: RenderPageState })
            .__AQR_STATE;
          return state
            ? {
                progress: state.progress,
                files_done: state.files_done,
                files_total: state.files_total,
              }
            : {};
        })
        .then((state) => applyRenderState(job, state))
        .catch(() => undefined);
    }, 1500);
    try {
      await page.goto(`${job.origin}/render/video`, { waitUntil: "load" });
      const state = await finished;
      // Les téléchargements partent avant la fin du rendu : on attend qu'ils soient tous enregistrés.
      const deadline = Date.now() + 60_000;
      while (saves.length < (state.total ?? 1) && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 200));
      await Promise.all(saves);
      job.files = job.files.filter(Boolean);
      job.file = job.files[0]?.path ?? null;
    } finally {
      clearInterval(progress);
      finished.catch(() => undefined);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
