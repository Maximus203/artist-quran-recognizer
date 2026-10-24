/**
 * Audio du direct, partie PURE (sans navigateur) : rééchantillonnage vers 16 kHz mono, conversion en
 * 16 bits petit-boutiste, découpage en blocs et tampon de coupure borné. Le service n'accepte que du
 * PCM 16 kHz mono s16le (docs/LIVE-PROTOCOL.md §3) ; la fréquence du contexte audio du navigateur
 * n'est pas garantie (44,1 ou 48 kHz, voire autre sur Safari), d'où le rééchantillonnage ici.
 */

/**
 * Rééchantillonneur en flux, par moyenne d'aire : chaque échantillon de sortie est la moyenne de la
 * fenêtre d'entrée qu'il recouvre (un filtre passe-bas simple, suffisant pour la parole). Il est
 * déterministe et indépendant du découpage de l'entrée : le flux donne exactement ce que donnerait le
 * fichier entier.
 */
export class Resampler {
  private readonly ratio: number;
  private pending: Float32Array = new Float32Array(0);
  private dropped = 0;
  private produced = 0;

  constructor(inputRate: number, outputRate: number) {
    if (
      !Number.isFinite(inputRate) ||
      !Number.isFinite(outputRate) ||
      inputRate <= 0 ||
      outputRate <= 0
    )
      throw new Error("fréquence d'échantillonnage invalide");
    this.ratio = inputRate / outputRate;
  }

  push(input: Float32Array): Float32Array {
    if (input.length) {
      const joined = new Float32Array(this.pending.length + input.length);
      joined.set(this.pending);
      joined.set(input, this.pending.length);
      this.pending = joined;
    }
    const available = this.dropped + this.pending.length;
    const out: number[] = [];
    for (;;) {
      const start = this.produced * this.ratio;
      const end = start + this.ratio;
      if (end > available + 1e-9) break;
      let sum = 0;
      for (let i = Math.floor(start); i < Math.ceil(end - 1e-9); i += 1) {
        const weight = Math.min(end, i + 1) - Math.max(start, i);
        sum += weight * this.pending[i - this.dropped];
      }
      out.push(sum / this.ratio);
      this.produced += 1;
    }
    const keepFrom = Math.floor(this.produced * this.ratio);
    if (keepFrom > this.dropped) {
      this.pending = this.pending.slice(keepFrom - this.dropped);
      this.dropped = keepFrom;
    }
    return Float32Array.from(out);
  }
}

/** Niveau efficace (0–1) d'un bloc : sert au ruban de niveau, jamais à décider d'un verset. */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

/** Flottants −1…1 → octets PCM 16 bits petit-boutiste (borné ; une valeur absurde devient du silence). */
export function floatsToPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i];
    const clamped = Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
    view.setInt16(
      i * 2,
      Math.round(clamped < 0 ? clamped * 32768 : clamped * 32767),
      true,
    );
  }
  return bytes;
}

export const silenceBytes = (samples: number): Uint8Array =>
  new Uint8Array(samples * 2);

/** Découpe un flux d'octets PCM en blocs de taille fixe (en échantillons) ; le reste attend le suivant. */
export class BlockCutter {
  private readonly blockBytes: number;
  private rest: Uint8Array = new Uint8Array(0);

  constructor(blockSamples: number) {
    if (!Number.isInteger(blockSamples) || blockSamples < 1)
      throw new Error("taille de bloc invalide");
    this.blockBytes = blockSamples * 2;
  }

  get pendingBytes(): number {
    return this.rest.length;
  }

  push(bytes: Uint8Array): Uint8Array[] {
    const joined = new Uint8Array(this.rest.length + bytes.length);
    joined.set(this.rest);
    joined.set(bytes, this.rest.length);
    const blocks: Uint8Array[] = [];
    let at = 0;
    for (; at + this.blockBytes <= joined.length; at += this.blockBytes)
      blocks.push(joined.slice(at, at + this.blockBytes));
    this.rest = joined.slice(at);
    return blocks;
  }

  /** Le reste (nombre pair d'octets), ou `null` s'il n'y en a pas. */
  flush(): Uint8Array | null {
    const even = this.rest.length - (this.rest.length % 2);
    const out = even ? this.rest.slice(0, even) : null;
    this.rest = new Uint8Array(0);
    return out;
  }
}

/**
 * Chaîne complète d'un bloc du micro vers le service : rééchantillonnage → 16 bits → blocs de taille
 * fixe. Rend aussi le niveau (efficace) du bloc d'entrée, pour le ruban.
 */
export class PcmPipeline {
  private readonly resampler: Resampler;
  private readonly cutter: BlockCutter;

  constructor(inputRate: number, outputRate: number, blockSamples: number) {
    this.resampler = new Resampler(inputRate, outputRate);
    this.cutter = new BlockCutter(blockSamples);
  }

  push(samples: Float32Array): { blocks: Uint8Array[]; level: number } {
    const resampled = this.resampler.push(samples);
    return {
      blocks: this.cutter.push(floatsToPcm16(resampled)),
      level: rms(samples),
    };
  }

  /** Ce qui reste, à envoyer avant la fin. */
  flush(): Uint8Array | null {
    return this.cutter.flush();
  }
}

/**
 * Tampon de coupure : garde les derniers blocs envoyés (ou à envoyer) pour pouvoir les renvoyer à
 * partir de `audio_received_samples` après une coupure. Borné (`maxSamples`) : au-delà, les plus
 * vieux blocs partent et le trou est annoncé (`gapSamples`) au lieu d'être caché.
 */
export class PcmBuffer {
  private blocks: { start: number; bytes: Uint8Array }[] = [];
  private total = 0;

  constructor(private readonly maxSamples: number) {}

  get totalSamples(): number {
    return this.total;
  }
  get startSample(): number {
    return this.blocks.length ? this.blocks[0].start : this.total;
  }
  get retainedSamples(): number {
    return this.total - this.startSample;
  }

  append(bytes: Uint8Array): void {
    if (bytes.length % 2)
      throw new Error("PCM 16 bits : nombre d'octets impair");
    if (!bytes.length) return;
    this.blocks.push({ start: this.total, bytes });
    this.total += bytes.length / 2;
    while (this.blocks.length > 1 && this.retainedSamples > this.maxSamples)
      this.blocks.shift();
  }

  /** Tout ce qui est gardé à partir de l'échantillon `sample`, et combien d'échantillons manquent avant. */
  from(sample: number): { blocks: Uint8Array[]; gapSamples: number } {
    if (sample >= this.total) return { blocks: [], gapSamples: 0 };
    const gapSamples = Math.max(0, this.startSample - sample);
    const out: Uint8Array[] = [];
    for (const block of this.blocks) {
      const end = block.start + block.bytes.length / 2;
      if (end <= sample) continue;
      const skip = Math.max(0, sample - block.start);
      out.push(skip ? block.bytes.subarray(skip * 2) : block.bytes);
    }
    return { blocks: out, gapSamples };
  }
}
