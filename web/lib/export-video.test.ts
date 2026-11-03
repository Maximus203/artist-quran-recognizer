import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  readSession: vi.fn(),
  audioPath: vi.fn(),
  sessionDir: vi.fn(),
  ensureListening: vi.fn(),
}));

vi.mock("./store", () => ({
  readSession: mocks.readSession,
  audioPath: mocks.audioPath,
  sessionDir: mocks.sessionDir,
}));

vi.mock("./listening", () => ({
  ensureListening: mocks.ensureListening,
  ffmpegCommand: () => "ffmpeg",
}));

import { NotReadyError } from "./export-engine";
import { jobDir, muxVideoFrames, writeFrameSegment } from "./export-video";

describe("writeFrameSegment", () => {
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(path.join(os.tmpdir(), "aqr-seg-"));
    mocks.sessionDir.mockReturnValue(dir);
  });

  it("écrit les segments dans le dossier du job, dans l'ordre", async () => {
    const job = "job-test-1234";
    await writeFrameSegment("s1", job, 0, Buffer.from("aaa"));
    await writeFrameSegment("s1", job, 1, Buffer.from("bbb"));
    const files = await readdir(jobDir("s1", job));
    expect(files.sort()).toEqual(["part-0.h264", "part-1.h264"]);
    expect(
      (await readFile(path.join(jobDir("s1", job), "part-1.h264"))).toString(),
    ).toBe("bbb");
  });

  it("refuse un segment qui arrive avant le précédent", async () => {
    await expect(
      writeFrameSegment("s1", "job-test-1234", 1, Buffer.from("bbb")),
    ).rejects.toThrow(/avant le segment/);
  });

  it("refuse un segment vide ou un job invalide", async () => {
    await expect(
      writeFrameSegment("s1", "job-test-1234", 0, Buffer.alloc(0)),
    ).rejects.toThrow(/vide/);
    await expect(
      writeFrameSegment("s1", "../evil", 0, Buffer.from("x")),
    ).rejects.toThrow();
  });
});

describe("muxVideoFrames", () => {
  let dir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    dir = await mkdtemp(path.join(os.tmpdir(), "aqr-mux-"));
    mocks.sessionDir.mockReturnValue(dir);
    mocks.readSession.mockResolvedValue({ state: "done", name: "Séance 1" });
    mocks.audioPath.mockResolvedValue(path.join(dir, "source.mp3"));
    mocks.ensureListening.mockResolvedValue({
      wav: path.join(dir, "listening", "listen.wav"),
      peaks: path.join(dir, "listening", "peaks.json"),
    });
    await import("node:fs/promises").then((fs) =>
      fs.mkdir(path.join(dir, "listening")),
    );
    await writeFile(
      path.join(dir, "listening", "peaks.json"),
      JSON.stringify({ duration: 42 }),
    );
  });

  it("rejette une session non terminée", async () => {
    mocks.readSession.mockResolvedValue({ state: "running", name: "x" });
    await expect(muxVideoFrames("s1", "job-test-0000")).rejects.toBeInstanceOf(
      NotReadyError,
    );
  });

  it("refuse un job sans segment", async () => {
    await expect(muxVideoFrames("s1", "job-test-0000")).rejects.toThrow(
      /Aucun segment/,
    );
  });

  it("muxe les segments dans l'ordre et nettoie le dossier du job", async () => {
    const job = "job-test-9999";
    await writeFrameSegment("s1", job, 0, Buffer.from("segment-zero"));
    await writeFrameSegment("s1", job, 1, Buffer.from("segment-un"));
    let capturedArgs: string[] = [];
    const run = vi.fn(async (_cmd: string, args: string[]) => {
      capturedArgs = args;
      const out = args[args.length - 1];
      await writeFile(out, Buffer.from("fake-mp4"));
      const video = (await readFile(args[args.indexOf("-i") + 1])).toString();
      if (video !== "segment-zerosegment-un")
        throw new Error(`segments mal assemblés : ${video}`);
    });

    const file = await muxVideoFrames("s1", job, run as never);
    expect(run).toHaveBeenCalledOnce();
    expect(capturedArgs.join(" ")).toContain("-f h264 -framerate 25");
    expect(capturedArgs.join(" ")).toContain("listen.wav");
    expect(file.mime).toBe("video/mp4");
    expect(file.content.toString("latin1")).toBe("fake-mp4");
    // Rien ne reste après le mux.
    await expect(readdir(jobDir("s1", job))).rejects.toThrow();
  });

  it("refuse des segments non contigus au moment du mux", async () => {
    const job = "job-test-8888";
    await writeFrameSegment("s1", job, 0, Buffer.from("a"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(jobDir("s1", job), { recursive: true });
    await writeFile(path.join(jobDir("s1", job), "part-2.h264"), "c");
    await expect(muxVideoFrames("s1", job)).rejects.toThrow(/non contigus/);
  });

  it("traduit l'échec de FFmpeg en message lisible", async () => {
    const job = "job-test-7777";
    await writeFrameSegment("s1", job, 0, Buffer.from("a"));
    const run = vi.fn(async () => {
      throw Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" });
    });
    await expect(muxVideoFrames("s1", job, run as never)).rejects.toThrow(
      /ffmpeg introuvable/,
    );
  });
});
