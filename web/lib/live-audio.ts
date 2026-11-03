/**
 * Capture du micro pour le direct (navigateur seulement) : `getUserMedia` → `AudioWorklet` → blocs de
 * flottants à la fréquence du contexte audio, que `lib/live-pcm.ts` rééchantillonne vers 16 kHz.
 * En parallèle, un `MediaRecorder` garde l'enregistrement EN MÉMOIRE, pour le seul geste « Garder cet
 * enregistrement » : rien n'en sort sans ce geste (docs/design/en-direct.md §2.6). Ce fichier ne
 * contient aucune règle métier ; il est vérifié dans un vrai navigateur, pas par des tests unitaires.
 */
import { LIVE_UI } from "./live-config";
import { recordingExtension, supportedRecordingType } from "./recording";

export const WORKLET_URL = "/worklets/live-capture.js";

export type Support = { secure: boolean; hasApi: boolean };

/** Ce que le navigateur sait faire ici (page sécurisée, capture, worklet, WebSocket). */
export function liveSupport(): Support {
  const w = typeof window === "undefined" ? null : window;
  const secure = !!w && w.isSecureContext;
  const hasApi =
    !!w &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof w.AudioContext === "function" &&
    typeof AudioWorkletNode === "function" &&
    typeof w.WebSocket === "function";
  return { secure, hasApi };
}

export type KeepRecorder = {
  pause(): void;
  resume(): void;
  /** Termine et rend le fichier (ou `null` si rien n'a pu être gardé). */
  finish(): Promise<File | null>;
  truncated(): boolean;
};

function startRecorder(stream: MediaStream): KeepRecorder | null {
  if (typeof MediaRecorder === "undefined") return null;
  const mime = supportedRecordingType((type) =>
    MediaRecorder.isTypeSupported(type),
  );
  if (!mime) return null;
  let recorder: MediaRecorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime });
  } catch {
    return null;
  }
  const chunks: Blob[] = [];
  let bytes = 0;
  let truncated = false;
  recorder.ondataavailable = (event) => {
    if (!event.data.size) return;
    if (bytes + event.data.size > LIVE_UI.keepMaxBytes) {
      truncated = true;
      return;
    }
    bytes += event.data.size;
    chunks.push(event.data);
  };
  recorder.start(1000);
  return {
    pause: () => {
      if (recorder.state === "recording") recorder.pause();
    },
    resume: () => {
      if (recorder.state === "paused") recorder.resume();
    },
    truncated: () => truncated,
    finish: () =>
      new Promise((resolve) => {
        const done = () => {
          if (!chunks.length) return resolve(null);
          const type = recorder.mimeType || mime;
          const extension = recordingExtension(type) ?? ".webm";
          resolve(
            new File(chunks, `recitation-en-direct${extension}`, { type }),
          );
        };
        if (recorder.state === "inactive") return done();
        recorder.onstop = done;
        recorder.stop();
      }),
  };
}

export type MicCapture = {
  /** Fréquence réelle du contexte audio (les blocs sont à cette fréquence). */
  sampleRate: number;
  setMuted(muted: boolean): void;
  recorder: KeepRecorder | null;
  /** Ferme le micro. */
  close(): Promise<void>;
};

/**
 * Ouvre le micro et démarre la capture. Lève l'erreur du navigateur telle quelle (`NotAllowedError`,
 * `NotFoundError`…) : `micErrorKey` la traduit en écran. Les blocs arrivent par `onBlock`.
 */
export async function openMic(
  onBlock: (samples: Float32Array, sampleRate: number) => void,
): Promise<MicCapture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1 },
  });
  let context: AudioContext | null = null;
  try {
    context = new AudioContext({ latencyHint: "interactive" });
    await context.audioWorklet.addModule(WORKLET_URL);
    if (context.state === "suspended") await context.resume();
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "aqr-live-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { chunkMs: 20 },
    });
    const rate = context.sampleRate;
    node.port.onmessage = (event: MessageEvent<Float32Array>) =>
      onBlock(event.data, rate);
    // Le nœud est tiré par le graphe, mais rien n'est joué : sortie coupée.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(node);
    node.connect(mute);
    mute.connect(context.destination);
    const recorder = startRecorder(stream);
    const track = stream.getAudioTracks()[0];
    const ctx = context;
    return {
      sampleRate: ctx.sampleRate,
      recorder,
      setMuted: (muted) => {
        node.port.postMessage({ muted });
        if (track) track.enabled = !muted;
      },
      close: async () => {
        node.port.onmessage = null;
        try {
          source.disconnect();
          node.disconnect();
        } catch {
          // déjà déconnecté
        }
        stream.getTracks().forEach((t) => t.stop());
        await ctx.close().catch(() => undefined);
      },
    };
  } catch (error) {
    stream.getTracks().forEach((t) => t.stop());
    await context?.close().catch(() => undefined);
    throw error;
  }
}
