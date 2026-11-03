import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { muxArgs } from "./export-video-args";

const exec = promisify(execFile);
const FFMPEG = process.env.AQR_FFMPEG || "ffmpeg";

function hasFfmpeg(): boolean {
  try {
    execFileSync(FFMPEG, ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Durée décodée d'un seul flux (« time= » final de la sortie de décodage). */
async function decodedSeconds(file: string, map: string): Promise<number> {
  const { stderr } = await exec(FFMPEG, [
    "-hide_banner",
    "-i",
    file,
    "-map",
    map,
    "-f",
    "null",
    "-",
  ]);
  const all = [...stderr.matchAll(/time=(\d+):(\d+):(\d+\.\d+)/g)];
  const last = all.at(-1);
  if (!last) throw new Error(`durée illisible : ${stderr.slice(-300)}`);
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]);
}

// Vrai FFmpeg : le bug constaté sur un export réel (vidéo de 2 s, aucune bande son) ne
// se voyait qu'avec lui — les tests à commande simulée ne pouvaient pas l'attraper.
describe.skipIf(!hasFfmpeg())("mux réel avec FFmpeg", () => {
  it("garde la durée de la vidéo ET la bande son", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "aqr-mux-"));
    try {
      const video = path.join(dir, "video.h264");
      const wav = path.join(dir, "a.wav");
      const out = path.join(dir, "out.mp4");
      await exec(FFMPEG, [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=320x240:rate=25",
        "-t",
        "4",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-f",
        "h264",
        video,
      ]);
      await exec(FFMPEG, [
        "-v",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=16000",
        "-t",
        "4",
        wav,
      ]);
      await exec(FFMPEG, muxArgs({ video, wav, out, fps: 25 }));
      expect((await readFile(out)).length).toBeGreaterThan(1000);
      expect(await decodedSeconds(out, "0:v:0")).toBeGreaterThan(3.8);
      expect(await decodedSeconds(out, "0:a:0")).toBeGreaterThan(3.8);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
