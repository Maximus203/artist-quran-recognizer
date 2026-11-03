import { describe, expect, it } from "vitest";
import {
  ClipRejected,
  clipFfmpegArgs,
  clipFfprobeArgs,
  inputFormatOf,
  parseClipProbe,
} from "./background-video-media";
import { copyArgs } from "./video-browser-copy";

const probe = (streams: unknown[], format: unknown = { duration: "12.5" }) =>
  JSON.stringify({ streams, format });
const video = (over: Record<string, unknown> = {}) => ({
  codec_name: "h264",
  width: 1920,
  height: 1080,
  ...over,
});

describe("lecture de la sonde (ffprobe) d'une vidéo de fond", () => {
  it("donne durée et taille affichée", () => {
    expect(parseClipProbe(probe([video()]))).toEqual({
      duration: 12.5,
      width: 1920,
      height: 1080,
      codec: "h264",
    });
  });

  it("applique la rotation d'un téléphone tenu à la verticale", () => {
    const out = parseClipProbe(
      probe([video({ side_data_list: [{ rotation: -90 }] })]),
    );
    expect([out.width, out.height]).toEqual([1080, 1920]);
  });

  it("une durée absente est « inconnue » (null), jamais inventée", () => {
    expect(parseClipProbe(probe([video()], { duration: "N/A" })).duration).toBe(
      null,
    );
    expect(parseClipProbe(probe([video()], {})).duration).toBe(null);
    expect(parseClipProbe(probe([video()], { duration: "0" })).duration).toBe(
      null,
    );
  });

  it("refuse un fichier sans image : du son seul", () => {
    expect(() => parseClipProbe(probe([]))).toThrowError(ClipRejected);
    try {
      parseClipProbe(probe([]));
    } catch (error) {
      expect((error as ClipRejected).code).toBe("no_video");
    }
  });

  it("refuse une « image » qui n'est qu'une pochette (musique avec cover)", () => {
    try {
      parseClipProbe(probe([video({ disposition: { attached_pic: 1 } })]));
      throw new Error("aurait dû refuser");
    } catch (error) {
      expect((error as ClipRejected).code).toBe("no_video");
    }
  });

  it("refuse une sortie illisible : fichier abîmé", () => {
    try {
      parseClipProbe("pas du json");
      throw new Error("aurait dû refuser");
    } catch (error) {
      expect((error as ClipRejected).code).toBe("unreadable");
    }
  });
});

describe("format d'entrée imposé (jamais deviné par ffmpeg)", () => {
  it("associe chaque famille reconnue à son démultiplexeur", () => {
    expect(inputFormatOf("isobmff")).toBe("mov");
    expect(inputFormatOf("matroska")).toBe("matroska");
    expect(inputFormatOf("avi")).toBe("avi");
  });
  it("refuse une famille qui n'est pas une vidéo", () => {
    expect(inputFormatOf("mp3")).toBeNull();
    expect(inputFormatOf("wav")).toBeNull();
    expect(inputFormatOf("ogg")).toBeNull();
  });
});

describe("arguments de la sonde", () => {
  it("impose le format, ne lit que le premier flux vidéo et ne suit aucun lien", () => {
    const args = clipFfprobeArgs("/tmp/x.mp4", "mov");
    expect(args).toContain("-f");
    expect(args[args.indexOf("-f") + 1]).toBe("mov");
    expect(args).toContain("v:0");
    expect(args.join(" ")).toContain("attached_pic");
    expect(args.at(-1)).toBe("/tmp/x.mp4");
  });
});

describe("arguments de la préparation (ffmpeg)", () => {
  const args = clipFfmpegArgs({
    source: "/tmp/in.mov",
    output: "/tmp/out.mp4",
    format: "mov",
    maxSeconds: 600,
  });
  const after = (flag: string) => args[args.indexOf(flag) + 1];

  it("impose le démultiplexeur et n'ouvre que le fichier local", () => {
    expect(args.indexOf("-f")).toBeLessThan(args.indexOf("-i"));
    expect(after("-f")).toBe("mov");
    expect(after("-i")).toBe("/tmp/in.mov");
    expect(after("-protocol_whitelist")).toBe("file");
  });

  it("supprime le son : la vidéo de fond est muette", () => {
    expect(args).toContain("-an");
    expect(args).not.toContain("-c:a");
  });

  it("limite la durée traitée au plafond (+1 s pour voir le dépassement)", () => {
    expect(after("-t")).toBe("601");
  });

  it("borne le débit, garde l'H.264 de la copie de rendu et finit par le fichier", () => {
    expect(after("-c:v")).toBe("libx264");
    expect(args).toContain("-maxrate");
    expect(args).toContain("+faststart");
    expect(args.at(-1)).toBe("/tmp/out.mp4");
  });

  it("la copie de la vidéo d'origine garde ses arguments d'avant", () => {
    const base = copyArgs("/s.mp4", "/o.mp4");
    expect(base).not.toContain("-protocol_whitelist");
    expect(base).not.toContain("-maxrate");
    expect(base).toContain("-an");
  });
});
