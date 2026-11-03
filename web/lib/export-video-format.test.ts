import { describe, expect, it } from "vitest";
import { h264Bitrate, h264Codec } from "./export-video-codecs";
import {
  estimateVideoMegabytes,
  videoDimensions,
  VIDEO_RESOLUTION_VALUES,
} from "./export-video-format";

describe("videoDimensions", () => {
  it("compte la résolution sur le côté court, dans chaque format", () => {
    expect(videoDimensions("16:9", 720)).toEqual({ width: 1280, height: 720 });
    expect(videoDimensions("9:16", 720)).toEqual({ width: 720, height: 1280 });
    expect(videoDimensions("1:1", 720)).toEqual({ width: 720, height: 720 });
    expect(videoDimensions("16:9", 2160)).toEqual({
      width: 3840,
      height: 2160,
    });
    expect(videoDimensions("16:9", 360)).toEqual({ width: 640, height: 360 });
  });
  it("garde le rapport d'une vidéo source et des dimensions paires", () => {
    const size = videoDimensions("16:9", 1080, { width: 1000, height: 700 });
    expect(size.height).toBe(1080);
    expect(size.width % 2).toBe(0);
    expect(videoDimensions("16:9", 720, { width: 720, height: 1280 })).toEqual({
      width: 720,
      height: 1280,
    });
  });
  it("donne toujours des dimensions paires", () => {
    for (const short of VIDEO_RESOLUTION_VALUES)
      for (const o of ["16:9", "9:16", "1:1"] as const) {
        const { width, height } = videoDimensions(o, short);
        expect(width % 2).toBe(0);
        expect(height % 2).toBe(0);
      }
  });
});

describe("niveau H.264", () => {
  it("monte de niveau avec la taille et la cadence", () => {
    expect(h264Codec(1920, 1080, 30)).toBe("avc1.640028");
    expect(h264Codec(1920, 1080, 60)).toBe("avc1.64002a");
    expect(h264Codec(1280, 720, 30)).toBe("avc1.64001f");
    expect(h264Codec(2560, 1440, 30)).toBe("avc1.640032");
    expect(h264Codec(3840, 2160, 30)).toBe("avc1.640033");
    expect(h264Codec(3840, 2160, 60)).toBe("avc1.640034");
  });
});

describe("poids estimé", () => {
  it("croît avec la cadence et la résolution, borné à 40 Mbit/s", () => {
    const light = h264Bitrate(1280, 720, 30);
    const heavy = h264Bitrate(3840, 2160, 60);
    expect(heavy).toBeGreaterThan(light);
    expect(heavy).toBeLessThanOrEqual(40_000_000);
    expect(estimateVideoMegabytes(light, 60)).toBeLessThan(
      estimateVideoMegabytes(heavy, 60),
    );
  });
});
