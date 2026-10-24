/* Capture du micro pour l'écoute en direct (AudioWorklet).
 * Reçoit le son par blocs de 128 échantillons, en regroupe ~20 ms, et les envoie au fil principal
 * (copie transférée, sans copie de plus). Aucun traitement du contenu : le rééchantillonnage vers
 * 16 kHz et la conversion en 16 bits se font dans lib/live-pcm.ts (testé). Fichier statique, servi tel quel. */
class AqrLiveCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const targetMs = (options.processorOptions && options.processorOptions.chunkMs) || 20;
    this.size = Math.max(128, Math.round((sampleRate * targetMs) / 1000));
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
    this.muted = false;
    this.port.onmessage = (event) => {
      if (event.data && typeof event.data.muted === "boolean") this.muted = event.data.muted;
    };
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || this.muted) return true;
    let offset = 0;
    while (offset < channel.length) {
      const take = Math.min(channel.length - offset, this.size - this.filled);
      this.buffer.set(channel.subarray(offset, offset + take), this.filled);
      this.filled += take;
      offset += take;
      if (this.filled === this.size) {
        const out = this.buffer;
        this.port.postMessage(out, [out.buffer]);
        this.buffer = new Float32Array(this.size);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor("aqr-live-capture", AqrLiveCapture);
