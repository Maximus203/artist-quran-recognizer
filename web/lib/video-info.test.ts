import { describe, expect, it } from "vitest";
import { NO_VIDEO, parseVideoInfo } from "./video-browser-copy";

const out = (stream: unknown) => JSON.stringify({ streams: [stream] });

describe("sonde de la vidéo d'origine (ffprobe)", () => {
  it("lit le codec et la taille", () => {
    expect(
      parseVideoInfo(out({ codec_name: "h264", width: 1920, height: 1080 })),
    ).toEqual({ codec: "h264", width: 1920, height: 1080 });
  });

  it("donne la taille AFFICHÉE d'une vidéo de téléphone tournée de 90°", () => {
    for (const rotation of [90, -90, 270])
      expect(
        parseVideoInfo(
          out({
            codec_name: "hevc",
            width: 1920,
            height: 1080,
            side_data_list: [{ rotation }],
          }),
        ),
      ).toEqual({ codec: "hevc", width: 1080, height: 1920 });
    expect(
      parseVideoInfo(
        out({
          codec_name: "h264",
          width: 1920,
          height: 1080,
          tags: { rotate: "90" },
        }),
      ),
    ).toEqual({ codec: "h264", width: 1080, height: 1920 });
  });

  it("ne tourne pas une vidéo à l'endroit ou retournée de 180°", () => {
    expect(
      parseVideoInfo(
        out({
          codec_name: "h264",
          width: 1280,
          height: 720,
          side_data_list: [{ rotation: 180 }],
        }),
      ),
    ).toEqual({ codec: "h264", width: 1280, height: 720 });
  });

  it("dit « aucune image » pour un son seul", () => {
    expect(parseVideoInfo(JSON.stringify({ streams: [] }))).toBe(NO_VIDEO);
    expect(parseVideoInfo("{}")).toBe(NO_VIDEO);
    expect(parseVideoInfo(out({ codec_name: "h264", width: 0 }))).toBe(
      NO_VIDEO,
    );
  });

  it("ne confond pas une sortie illisible avec un son seul", () => {
    expect(parseVideoInfo("pas du json")).toBeNull();
    expect(parseVideoInfo("")).toBeNull();
  });
});
