import { describe, expect, it } from "vitest";
import {
  even,
  muxArgs,
  orientationSize,
  VIDEO_ORIENTATIONS,
} from "./export-video-args";

describe("orientationSize", () => {
  it("donne les trois formats au choix de l'export", () => {
    expect(orientationSize("16:9")).toEqual({ width: 1920, height: 1080 });
    expect(orientationSize("9:16")).toEqual({ width: 1080, height: 1920 });
    expect(orientationSize("1:1")).toEqual({ width: 1080, height: 1080 });
    expect(VIDEO_ORIENTATIONS).toHaveLength(3);
  });
});

describe("even", () => {
  it("force les dimensions paires (H.264 4:2:0 l'exige)", () => {
    expect(even(853)).toBe(854);
    expect(even(479)).toBe(480);
    expect(even(1920)).toBe(1920);
  });
});

describe("muxArgs", () => {
  it("assemble le flux brut et la copie d'écoute en MP4 sans ré-encoder la vidéo", () => {
    const args = muxArgs({
      video: "all.h264",
      wav: "in.wav",
      out: "out.mp4",
      fps: 25,
    });
    const text = args.join(" ");
    expect(text).toContain("-fflags +genpts -f h264 -framerate 25 -i all.h264");
    expect(text).toContain("-i in.wav");
    expect(text).toContain("-map 0:v:0 -map 1:a:0");
    expect(text).toContain("-c:v copy -bsf:v setts=ts=N/(25*TB)");
    expect(text).toContain("-c:a aac -b:a 128k -ar 44100");
    expect(text).toContain("-movflags +faststart");
    expect(args[args.length - 1]).toBe("out.mp4");
  });

  it("n'utilise jamais -shortest : sur un flux brut il supprime toute la bande son", () => {
    const args = muxArgs({ video: "v", wav: "w", out: "o", fps: 25 });
    expect(args).not.toContain("-shortest");
  });
});
