import { clampEcho, echoMix, impulseResponse } from "@/lib/audio-echo";

/**
 * Montage Web Audio de l'écho : le son de l'élément `<audio>` passe par un « sec » (la voix telle quelle) et
 * par une réverbération (convolution avec une salle synthétique), dosés par `echoMix`. Le montage n'est créé
 * qu'au premier réglage non nul : tant que personne ne touche à l'écho, la lecture reste celle du navigateur.
 * Un élément ne peut être branché qu'une fois : le montage reste ensuite, transparent à zéro (sec = 1, écho = 0).
 */
const ROOM_SECONDS = 1.9;
const ROOM_DECAY = 2.6;
const SMOOTHING_S = 0.03;

type Graph = { set: (amount: number) => void };
const graphs = new WeakMap<HTMLAudioElement, Graph>();
let context: AudioContext | null = null;

function build(element: HTMLAudioElement): Graph | null {
  try {
    context ??= new AudioContext();
    const ctx = context;
    const source = ctx.createMediaElementSource(element);
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const room = ctx.createConvolver();
    const [left, right] = impulseResponse(
      ctx.sampleRate,
      ROOM_SECONDS,
      ROOM_DECAY,
    );
    const impulse = ctx.createBuffer(2, left.length, ctx.sampleRate);
    impulse.copyToChannel(left as Float32Array<ArrayBuffer>, 0);
    impulse.copyToChannel(right as Float32Array<ArrayBuffer>, 1);
    room.buffer = impulse;
    source.connect(dry).connect(ctx.destination);
    source.connect(room).connect(wet).connect(ctx.destination);
    // Un contexte créé avant tout geste reste suspendu : on le réveille à la lecture et à chaque réglage.
    element.addEventListener("play", () => void ctx.resume());
    return {
      set(amount) {
        const mix = echoMix(amount);
        dry.gain.setTargetAtTime(mix.dry, ctx.currentTime, SMOOTHING_S);
        wet.gain.setTargetAtTime(mix.wet, ctx.currentTime, SMOOTHING_S);
        void ctx.resume();
      },
    };
  } catch {
    // Navigateur sans Web Audio, ou élément déjà branché ailleurs : la lecture normale continue, sans écho.
    return null;
  }
}

/** Applique le réglage d'écho (0 à 1) à l'élément audio. Sans effet tant qu'il est à zéro et jamais réglé. */
export function applyEcho(element: HTMLAudioElement, amount: number): void {
  const value = clampEcho(amount);
  let graph = graphs.get(element);
  if (!graph) {
    if (value === 0) return;
    const built = build(element);
    if (!built) return;
    graph = built;
    graphs.set(element, graph);
  }
  graph.set(value);
}
