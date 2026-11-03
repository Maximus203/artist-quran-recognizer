import { describe, expect, it } from "vitest";
import {
  COPY_KEYFRAME_EVERY,
  COPY_LONG_SIDE,
  copyArgs,
  needsBrowserCopy,
  needsRenderCopy,
  NO_VIDEO,
  progressRatio,
} from "./video-browser-copy";

describe("copie de travail de la vidéo d'origine", () => {
  it("se fabrique pour toute vidéo, jamais pour un son seul", () => {
    for (const codec of ["h264", "hevc", "vp9", null])
      expect(needsRenderCopy(codec)).toBe(true);
    expect(needsRenderCopy(NO_VIDEO)).toBe(false);
  });

  it("garde la lecture directe pour les codecs que le navigateur sait lire", () => {
    expect(needsBrowserCopy("h264")).toBe(false);
    expect(needsBrowserCopy("hevc")).toBe(true);
  });

  it("réduit à 1080p au plus sans jamais agrandir, avec une image clé toutes les 8 images", () => {
    const args = copyArgs("in.mov", "out.mp4");
    const joined = args.join(" ");
    expect(COPY_LONG_SIDE).toBe(1920);
    expect(COPY_KEYFRAME_EVERY).toBe(8);
    expect(args).toContain("-an");
    expect(joined).toContain("min(1920,iw)");
    expect(joined).toContain("min(1920,ih)");
    expect(args[args.indexOf("-g") + 1]).toBe("8");
    expect(args[args.indexOf("-keyint_min") + 1]).toBe("8");
    expect(args[args.indexOf("-threads") + 1]).toBe("2");
    expect(args[args.length - 1]).toBe("out.mp4");
    expect(args[args.indexOf("-i") + 1]).toBe("in.mov");
  });

  it("lit l'avancement de ffmpeg", () => {
    expect(progressRatio("out_time_us=30000000", 120)).toBeCloseTo(0.25);
    expect(progressRatio("out_time_us=999999999", 120)).toBe(1);
    expect(progressRatio("progress=continue", 120)).toBeNull();
    expect(progressRatio("out_time_us=5000000", 0)).toBeNull();
  });
});
