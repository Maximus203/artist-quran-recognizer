import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LISTENING,
  computePeaks,
  ensureListening,
  listeningArgs,
  mediaType,
  parseWav,
  type Transcoder,
} from "./listening";

/** WAV PCM 16 bits mono minimal, avec un bloc LIST avant `data` (comme ffmpeg). */
function wav(samples: number[], sampleRate = LISTENING.sampleRate): Buffer {
  const list = Buffer.from("LIST\x04\x00\x00\x00INFO", "latin1");
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0, "latin1");
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(sampleRate, 12);
  fmt.writeUInt32LE(sampleRate * 2, 16);
  fmt.writeUInt16LE(2, 20);
  fmt.writeUInt16LE(16, 22);
  const head = Buffer.alloc(8);
  head.write("data", 0, "latin1");
  head.writeUInt32LE(data.length, 4);
  const body = Buffer.concat([
    Buffer.from("WAVE", "latin1"),
    fmt,
    list,
    head,
    data,
  ]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
}

describe("listeningArgs", () => {
  it("décode comme le moteur : mono, même fréquence, PCM 16 bits", () => {
    const args = listeningArgs("in.mp3", "out.wav");
    expect(args).toEqual([
      "-nostdin", "-v", "error", "-y", "-i", "in.mp3", "-vn",
      "-ac", "1", "-ar", String(LISTENING.sampleRate),
      "-c:a", "pcm_s16le", "-f", "wav", "out.wav",
    ]); // prettier-ignore
  });
  it("garde la fréquence du moteur (ffmpeg_extractor : 16 kHz)", () => {
    expect(LISTENING.sampleRate).toBe(16000);
  });
});

describe("parseWav", () => {
  it("trouve les données après un bloc LIST", () => {
    const info = parseWav(wav([1, -2, 3]));
    expect(info).toMatchObject({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      dataLength: 6,
    });
    expect(info.duration).toBeCloseTo(3 / 16000);
  });
  it("refuse ce qui n'est pas un WAV PCM 16 bits", () => {
    expect(() => parseWav(Buffer.from("ID3 pas un wav"))).toThrow(/WAV/);
  });
});

describe("computePeaks", () => {
  it("prend le maximum absolu de chaque tranche, normalisé à 1", () => {
    const peaks = computePeaks(
      Int16Array.from([0, 16384, -32768, 100, 0, -8192]),
      6,
      3,
    );
    expect(peaks).toEqual([0.5, 1, 0.25]);
  });
  it("garde une dernière tranche partielle", () => {
    expect(computePeaks(Int16Array.from([0, 0, 32767]), 4, 2)).toEqual([0, 1]);
  });
  it("audio vide : aucune crête", () => {
    expect(computePeaks(new Int16Array(0), 16000, 50)).toEqual([]);
  });
});

describe("mediaType", () => {
  it("annonce le vrai type du fichier original", () => {
    expect(mediaType(".mp3")).toBe("audio/mpeg");
    expect(mediaType(".M4A")).toBe("audio/mp4");
    expect(mediaType(".wav")).toBe("audio/wav");
    expect(mediaType(".MKV")).toBe("video/x-matroska");
    expect(mediaType(".mov")).toBe("video/quicktime");
    expect(mediaType(".avi")).toBe("video/x-msvideo");
    expect(mediaType(".m4v")).toBe("video/x-m4v");
    expect(mediaType(".xyz")).toBe("application/octet-stream");
  });
});

describe("ensureListening", () => {
  let dir: string;
  let source: string;
  const samples = Array.from({ length: 16000 }, (_, i) =>
    i === 8000 ? 32767 : 0,
  );
  const fake: Transcoder = vi.fn(async (_src: string, out: string) => {
    await writeFile(out, wav(samples));
  });
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "aqr-listen-"));
    source = path.join(dir, "source.mp3");
    await writeFile(source, "mp3");
    vi.mocked(fake).mockClear();
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("crée la copie d'écoute et ses crêtes dans listening/", async () => {
    const out = await ensureListening(dir, source, fake);
    expect(out.wav).toBe(path.join(dir, LISTENING.dir, LISTENING.wav));
    expect((await stat(out.wav)).size).toBeGreaterThan(32000);
    const peaks = JSON.parse(await readFile(out.peaks, "utf8"));
    expect(peaks).toMatchObject({
      schema: "aqr.listening-peaks/1",
      sample_rate: 16000,
      per_second: LISTENING.peaksPerSecond,
      duration: 1,
    });
    expect(peaks.peaks).toHaveLength(LISTENING.peaksPerSecond);
    expect(peaks.peaks[LISTENING.peaksPerSecond / 2]).toBe(1);
  });
  it("ne transcode qu'une fois, y compris sous appels simultanés", async () => {
    await Promise.all([
      ensureListening(dir, source, fake),
      ensureListening(dir, source, fake),
    ]);
    await ensureListening(dir, source, fake);
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it("refait la copie si la source est plus récente", async () => {
    await ensureListening(dir, source, fake);
    const later = new Date(Date.now() + 60_000);
    await utimes(source, later, later);
    await ensureListening(dir, source, fake);
    expect(fake).toHaveBeenCalledTimes(2);
  });
  it("un échec de ffmpeg ne laisse aucun fichier partiel et peut être retenté", async () => {
    const broken: Transcoder = async (_s, out) => {
      await writeFile(out, "partiel");
      throw new Error("ffmpeg introuvable");
    };
    await expect(ensureListening(dir, source, broken)).rejects.toThrow(
      /ffmpeg introuvable/,
    );
    await expect(
      stat(path.join(dir, LISTENING.dir, LISTENING.wav)),
    ).rejects.toThrow();
    await ensureListening(dir, source, fake);
    expect(fake).toHaveBeenCalledTimes(1);
  });
});
