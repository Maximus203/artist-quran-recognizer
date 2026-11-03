import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MediaRejected,
  ffprobeCommand,
  inspectUpload,
  parseProbe,
  type ProbeRunner,
} from "./media-probe";

afterEach(() => vi.unstubAllEnvs());

const json = (value: unknown) => JSON.stringify(value);

describe("parseProbe", () => {
  it("lit la durée et les types de pistes", () => {
    expect(
      parseProbe(
        json({
          streams: [{ codec_type: "video" }, { codec_type: "audio" }],
          format: { duration: "2742.698" },
        }),
      ),
    ).toEqual({ duration_s: 2742.698, has_audio: true, has_video: true });
  });
  it("préfère la durée de la piste audio à celle du conteneur (vidéo plus longue que le son)", () => {
    expect(
      parseProbe(
        json({
          streams: [
            { codec_type: "video", duration: "10.3" },
            { codec_type: "audio", duration: "4.601" },
          ],
          format: { duration: "10.3" },
        }),
      ).duration_s,
    ).toBe(4.601);
  });
  it("Matroska/WebM : la durée de la piste est dans l'étiquette DURATION quand duration vaut N/A", () => {
    expect(
      parseProbe(
        json({
          streams: [
            { codec_type: "video" },
            {
              codec_type: "audio",
              duration: "N/A",
              tags: { DURATION: "00:00:04.601000000" },
            },
          ],
          format: { duration: "10.3" },
        }),
      ).duration_s,
    ).toBe(4.601);
    expect(
      parseProbe(
        json({
          streams: [
            { codec_type: "audio", tags: { DURATION: "01:02:03.500000000" } },
          ],
          format: { duration: "9" },
        }),
      ).duration_s,
    ).toBe(3723.5);
  });
  it("étiquette DURATION absurde : repli sur le conteneur", () => {
    expect(
      parseProbe(
        json({
          streams: [
            { codec_type: "audio", tags: { DURATION: "n'importe quoi" } },
          ],
          format: { duration: "9" },
        }),
      ).duration_s,
    ).toBe(9);
  });
  it("repli sur le conteneur quand la piste audio n'annonce pas de durée", () => {
    expect(
      parseProbe(
        json({
          streams: [{ codec_type: "audio", duration: "N/A" }],
          format: { duration: "61.2" },
        }),
      ).duration_s,
    ).toBe(61.2);
  });
  it("vidéo muette : aucune piste audio", () => {
    expect(
      parseProbe(
        json({
          streams: [{ codec_type: "video" }],
          format: { duration: "10" },
        }),
      ),
    ).toEqual({ duration_s: 10, has_audio: false, has_video: true });
  });
  it("durée absente ou absurde : null, jamais NaN ni 0", () => {
    for (const duration of [undefined, "N/A", "0", "-3", "abc"])
      expect(
        parseProbe(
          json({ streams: [{ codec_type: "audio" }], format: { duration } }),
        ).duration_s,
      ).toBeNull();
  });
  it("sortie illisible : erreur explicite", () => {
    expect(() => parseProbe("pas du json")).toThrow(/illisible/);
    expect(parseProbe("{}")).toEqual({
      duration_s: null,
      has_audio: false,
      has_video: false,
    });
  });
});

describe("ffprobeCommand", () => {
  it("AQR_FFPROBE d'abord", () => {
    vi.stubEnv("AQR_FFPROBE", "C:\\outils\\ffprobe.exe");
    expect(ffprobeCommand()).toBe("C:\\outils\\ffprobe.exe");
  });
  it("sinon le ffprobe voisin de AQR_FFMPEG (comme le moteur), sinon celui du PATH", () => {
    vi.stubEnv("AQR_FFPROBE", "");
    vi.stubEnv("AQR_FFMPEG", "/opt/ff/bin/ffmpeg");
    expect(ffprobeCommand().replaceAll("\\", "/")).toBe("/opt/ff/bin/ffprobe");
    vi.stubEnv("AQR_FFMPEG", "ffmpeg");
    expect(ffprobeCommand()).toBe("ffprobe");
    vi.stubEnv("AQR_FFMPEG", "");
    expect(ffprobeCommand()).toBe("ffprobe");
  });
});

const ok =
  (value: unknown): ProbeRunner =>
  async () =>
    json(value);
const missing: ProbeRunner = async () => {
  throw Object.assign(new Error("spawn ffprobe ENOENT"), { code: "ENOENT" });
};
const broken: ProbeRunner = async () => {
  throw Object.assign(new Error("Invalid data found"), {
    code: 1,
    stderr: "moov atom not found",
  });
};

describe("inspectUpload — vérifier le fichier avant de le garder", () => {
  it("renvoie la durée d'un fichier sain", async () => {
    const result = await inspectUpload(
      "/x/a.mp4",
      ".mp4",
      ok({
        streams: [{ codec_type: "video" }, { codec_type: "audio" }],
        format: { duration: "61.5" },
      }),
    );
    expect(result).toEqual({ duration_s: 61.5, probed: true });
  });
  it("refuse une vidéo sans piste audio, clairement", async () => {
    const promise = inspectUpload(
      "/x/a.mp4",
      ".mp4",
      ok({ streams: [{ codec_type: "video" }], format: { duration: "10" } }),
    );
    await expect(promise).rejects.toBeInstanceOf(MediaRejected);
    await expect(promise).rejects.toThrow(/aucune piste audio/);
  });
  it("refuse un fichier audio qui n'a aucune piste audio", async () => {
    await expect(
      inspectUpload(
        "/x/a.mp3",
        ".mp3",
        ok({ streams: [], format: { duration: "10" } }),
      ),
    ).rejects.toThrow(/aucune piste audio/);
  });
  it("fichier illisible (vidéo ou audio) : refus clair à l'import, pas un échec 6 secondes plus tard", async () => {
    await expect(inspectUpload("/x/a.mkv", ".mkv", broken)).rejects.toThrow(
      /vidéo est illisible/,
    );
    const audio = inspectUpload("/x/a.mp3", ".mp3", broken);
    await expect(audio).rejects.toBeInstanceOf(MediaRejected);
    await expect(audio).rejects.toThrow(/audio est illisible/);
  });
  it("ffprobe absent : on n'invente rien, on accepte sans durée", async () => {
    expect(await inspectUpload("/x/a.mp4", ".mp4", missing)).toEqual({
      duration_s: null,
      probed: false,
    });
  });
  it("une erreur inattendue (ni absente ni de lecture) remonte", async () => {
    await expect(
      inspectUpload("/x/a.mp3", ".mp3", async () => {
        throw new TypeError("bug");
      }),
    ).rejects.toThrow("bug");
  });
});
