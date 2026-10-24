import { describe, expect, it } from "vitest";
import {
  BlockCutter,
  PcmBuffer,
  Resampler,
  floatsToPcm16,
  rms,
  silenceBytes,
} from "./live-pcm";

const sine = (hz: number, rate: number, seconds: number, amp = 0.5) =>
  Float32Array.from(
    { length: Math.round(rate * seconds) },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate),
  );

function crossings(samples: Float32Array): number {
  let n = 0;
  for (let i = 1; i < samples.length; i += 1)
    if (samples[i - 1] < 0 && samples[i] >= 0) n += 1;
  return n;
}

describe("Resampler", () => {
  it("48 kHz → 16 kHz garde la fréquence et le niveau d'un sinus", () => {
    const input = sine(440, 48000, 1);
    const out = new Resampler(48000, 16000).push(input);
    expect(Math.abs(out.length - 16000)).toBeLessThanOrEqual(2);
    expect(Math.abs(crossings(out) - 440)).toBeLessThanOrEqual(3);
    expect(Math.abs(rms(out) - rms(input))).toBeLessThan(0.02);
  });

  it("le découpage de l'entrée ne change pas la sortie (flux = fichier)", () => {
    const input = sine(300, 44100, 0.7);
    const whole = new Resampler(44100, 16000).push(input);
    const r = new Resampler(44100, 16000);
    const parts: Float32Array[] = [];
    for (let i = 0; i < input.length; ) {
      const size = 1 + ((i * 7) % 211); // morceaux de tailles irrégulières
      parts.push(r.push(input.subarray(i, i + size)));
      i += size;
    }
    const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      joined.set(p, at);
      at += p.length;
    }
    expect(joined.length).toBe(whole.length);
    for (let i = 0; i < whole.length; i += 1)
      expect(joined[i]).toBeCloseTo(whole[i], 5);
  });

  it("16 kHz → 16 kHz est transparent", () => {
    const input = sine(200, 16000, 0.25);
    const out = new Resampler(16000, 16000).push(input);
    expect(out.length).toBe(input.length);
    expect(out[100]).toBeCloseTo(input[100], 6);
  });

  it("une entrée plus lente que la sortie est sur-échantillonnée sans trou", () => {
    const out = new Resampler(8000, 16000).push(sine(100, 8000, 0.5));
    expect(Math.abs(out.length - 8000)).toBeLessThanOrEqual(2);
    expect(out.every(Number.isFinite)).toBe(true);
  });

  it("refuse une fréquence absurde", () => {
    expect(() => new Resampler(0, 16000)).toThrow();
    expect(() => new Resampler(48000, -1)).toThrow();
  });
});

describe("floatsToPcm16", () => {
  it("écrit du 16 bits petit-boutiste, borné", () => {
    const bytes = floatsToPcm16(Float32Array.of(0, 0.5, -0.5, 1, -1, 2, -3));
    expect(bytes.byteLength).toBe(14);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(16384);
    expect(view.getInt16(4, true)).toBe(-16384);
    expect(view.getInt16(6, true)).toBe(32767);
    expect(view.getInt16(8, true)).toBe(-32768);
    expect(view.getInt16(10, true)).toBe(32767);
    expect(view.getInt16(12, true)).toBe(-32768);
  });
  it("une valeur NaN devient du silence, jamais du bruit", () => {
    const bytes = floatsToPcm16(Float32Array.of(NaN));
    expect(new DataView(bytes.buffer).getInt16(0, true)).toBe(0);
  });
});

describe("BlockCutter", () => {
  it("rend des blocs de taille fixe (multiple de 2 octets) et garde le reste", () => {
    const cutter = new BlockCutter(1600);
    expect(cutter.push(new Uint8Array(1000))).toEqual([]);
    const blocks = cutter.push(new Uint8Array(4500));
    expect(blocks.map((b) => b.byteLength)).toEqual([3200]);
    expect(cutter.pendingBytes).toBe(2300);
  });
  it("flush rend le reste, pair", () => {
    const cutter = new BlockCutter(100);
    cutter.push(new Uint8Array(51));
    const rest = cutter.flush();
    expect(rest?.byteLength).toBe(50);
    expect(cutter.flush()).toBeNull();
  });
});

describe("PcmBuffer (tampon de coupure borné)", () => {
  const block = (n: number, fill: number) => new Uint8Array(n * 2).fill(fill);

  it("rend tout depuis un échantillon donné, bloc coupé au besoin", () => {
    const buf = new PcmBuffer(1000);
    buf.append(block(100, 1));
    buf.append(block(100, 2));
    expect(buf.totalSamples).toBe(200);
    const out = buf.from(150);
    expect(out.gapSamples).toBe(0);
    expect(out.blocks.map((b) => b.byteLength)).toEqual([100]);
    expect(out.blocks[0][0]).toBe(2);
    expect(buf.from(200).blocks).toEqual([]);
  });

  it("borne sa mémoire : les plus vieux blocs partent, le trou est annoncé", () => {
    const buf = new PcmBuffer(250);
    for (let i = 0; i < 5; i += 1) buf.append(block(100, i));
    expect(buf.totalSamples).toBe(500);
    expect(buf.startSample).toBeGreaterThanOrEqual(250);
    expect(buf.retainedSamples).toBeLessThanOrEqual(250 + 100);
    const out = buf.from(0);
    expect(out.gapSamples).toBe(buf.startSample);
    expect(out.blocks.reduce((n, b) => n + b.byteLength / 2, 0)).toBe(
      500 - buf.startSample,
    );
  });

  it("demander l'avenir ne rend rien et ne plante pas", () => {
    const buf = new PcmBuffer(100);
    buf.append(block(10, 1));
    expect(buf.from(999)).toEqual({ blocks: [], gapSamples: 0 });
  });

  it("silenceBytes produit des échantillons nuls", () => {
    const zeros = silenceBytes(160);
    expect(zeros.byteLength).toBe(320);
    expect(zeros.every((b) => b === 0)).toBe(true);
  });
});
