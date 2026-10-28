/**
 * Encodeur H.264 de la vidéo d'export (WebCodecs) : les frames dessinées sur canvas sont
 * encodées en flux élémentaire H.264 (Annex B, muxé ensuite en MP4 côté serveur). Le flux
 * est découpé en segments d'au plus `segmentFrames` images — le navigateur les envoie les
 * uns après les autres (POST par segment), sans jamais monter un énorme corps en mémoire.
 */

export const VIDEO_SEGMENT_FRAMES = 25 * 60 * 5; // 5 minutes à 25 im/s

export class VideoEncoderUnavailableError extends Error {
  constructor() {
    super(
      "Ce navigateur ne peut pas encoder la vidéo (WebCodecs H.264 requis : Chrome ou Edge récent).",
    );
    this.name = "VideoEncoderUnavailableError";
  }
}

export type VideoSegment = {
  /** Numéro du segment (0-based), dans l'ordre d'envoi. */
  index: number;
  data: Uint8Array;
  /** True pour le dernier segment de l'export. */
  last: boolean;
  frames: number;
};

export type EncodeResult = {
  width: number;
  height: number;
  segments: VideoSegment[];
  frames: number;
};

/** Débit cible (~0,08 bit/pixel/image), borné : le contenu est majoritairement statique. */
export function h264Bitrate(
  width: number,
  height: number,
  fps: number,
): number {
  return Math.min(
    12_000_000,
    Math.max(2_000_000, Math.round(width * height * fps * 0.08)),
  );
}

/** Configuration encodeur pour la taille demandée, ou null si non supportée. */
export async function h264Config(
  width: number,
  height: number,
  fps: number,
): Promise<VideoEncoderConfig | null> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined")
    return null;
  const config: VideoEncoderConfig = {
    codec: "avc1.640028", // High 4.0 : 1080p
    width,
    height,
    bitrate: h264Bitrate(width, height, fps),
    framerate: fps,
    latencyMode: "quality",
    avc: { format: "annexb" },
  } as VideoEncoderConfig;
  try {
    const support = await VideoEncoder.isConfigSupported(config);
    return support.supported ? config : null;
  } catch {
    return null;
  }
}

const KEYFRAME_INTERVAL = 25 * 5; // une image clé toutes les 5 s (seek, découpe propre)

/**
 * Encode `frameCount` frames dessinées par `draw` sur le canvas fourni. Le moteur appelle
 * `draw(ctx, index)` pour chaque image (l'appel doit être rapide : aucune attente dedans —
 * la recherche d'images d'une éventuelle vidéo de fond se fait via `beforeFrame`, qui peut
 * être asynchrone).
 */
export async function encodeFrames(options: {
  canvas: HTMLCanvasElement;
  config: VideoEncoderConfig;
  fps: number;
  frameCount: number;
  segmentFrames?: number;
  draw: (ctx: CanvasRenderingContext2D, index: number) => void;
  beforeFrame?: (index: number) => Promise<void> | void;
  onProgress?: (done: number, total: number) => void;
}): Promise<EncodeResult> {
  const { canvas, config, fps, frameCount, draw, beforeFrame, onProgress } =
    options;
  const segmentFrames = Math.max(
    1,
    options.segmentFrames ?? VIDEO_SEGMENT_FRAMES,
  );
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D indisponible.");

  const segments: VideoSegment[] = [];
  let pending: Uint8Array[] = [];
  let pendingFrames = 0;
  let encoded = 0;

  const encoder = new VideoEncoder({
    output: (chunk) => {
      const buffer = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buffer);
      pending.push(new Uint8Array(buffer));
      pendingFrames += 1;
      if (pendingFrames >= segmentFrames && chunk.type === "key") {
        // Un segment ne démarre qu'sur une image clé : découpe propre pour le mux.
        segments.push({
          index: segments.length,
          data: concat(pending),
          last: false,
          frames: pendingFrames,
        });
        pending = [];
        pendingFrames = 0;
      }
    },
    error: (e) => {
      throw e;
    },
  });
  encoder.configure(config);

  const microsPerFrame = 1_000_000 / fps;
  for (let index = 0; index < frameCount; index++) {
    await beforeFrame?.(index);
    draw(ctx, index);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round(index * microsPerFrame),
      duration: Math.round(microsPerFrame),
    });
    encoder.encode(frame, { keyFrame: index % KEYFRAME_INTERVAL === 0 });
    frame.close();
    encoded += 1;
    if (encoded % 25 === 0) {
      onProgress?.(encoded, frameCount);
      // Laisser souffler l'interface et le collecteur de chunks.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (encoder.encodeQueueSize > 8) {
      await new Promise<void>((resolve) => {
        encoder.addEventListener("dequeue", () => resolve(), { once: true });
      });
    }
  }
  await encoder.flush();
  encoder.close();

  if (pendingFrames > 0 || segments.length === 0) {
    segments.push({
      index: segments.length,
      data: concat(pending),
      last: false,
      frames: pendingFrames,
    });
  }
  segments[segments.length - 1].last = true;
  return {
    width: config.width,
    height: config.height,
    segments,
    frames: encoded,
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Jeton de job côté client (porté sur chaque segment POSTé). */
export function newVideoJob(): string {
  return crypto.randomUUID();
}
