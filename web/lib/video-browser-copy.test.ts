import { describe, expect, it } from "vitest";
import { BROWSER_VIDEO_CODECS, needsBrowserCopy } from "./video-browser-copy";

describe("copie de la vidéo pour le navigateur du serveur", () => {
  it("garde les codecs que Chrome sur Linux lit (H.264, VP8, VP9, AV1)", () => {
    for (const codec of ["h264", "vp8", "vp9", "av1"])
      expect(needsBrowserCopy(codec)).toBe(false);
    expect(BROWSER_VIDEO_CODECS.has("hevc")).toBe(false);
  });

  it("fabrique une copie pour le HEVC des téléphones, et quand le codec est inconnu", () => {
    expect(needsBrowserCopy("hevc")).toBe(true);
    expect(needsBrowserCopy("HEVC")).toBe(true);
    expect(needsBrowserCopy(null)).toBe(true);
  });
});
