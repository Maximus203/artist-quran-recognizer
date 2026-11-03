/**
 * Types partagés de l'export vidéo et constructeur de la commande de mux. Le rendu est
 * fait par le navigateur (frames H.264 en Annex B) ; le serveur ne fait qu'assembler :
 * segments concaténés (démuxer concat) + copie d'écoute → MP4 H.264/AAC.
 */

export type VideoOrientation = "16:9" | "9:16" | "1:1";

export const VIDEO_ORIENTATIONS: readonly VideoOrientation[] = [
  "16:9",
  "9:16",
  "1:1",
];

export const orientationSize = (
  orientation: VideoOrientation,
): { width: number; height: number } => {
  switch (orientation) {
    case "16:9":
      return { width: 1920, height: 1080 };
    case "9:16":
      return { width: 1080, height: 1920 };
    case "1:1":
      return { width: 1080, height: 1080 };
  }
};

/** Dimensions paires (H.264 4:2:0 l'exige). */
export const even = (n: number): number => 2 * Math.round(n / 2);

/**
 * argv du mux : flux H.264 brut (segments déjà mis bout à bout) + copie d'écoute → MP4.
 * Fonction pure, testée. Le flux brut n'a pas d'horodatage : `-framerate` + `genpts` lui en
 * donnent (le filtre `setts` impose le rythme), et il n'y a PAS de `-shortest` — sur un flux brut il coupait toute la bande son.
 */
export function muxArgs(options: {
  video: string;
  wav: string;
  out: string;
  fps: number;
  /** Extrait de l'audio à garder (secondes) : la vidéo d'une plage ne porte que son passage. */
  audioStart?: number;
  audioDuration?: number;
}): string[] {
  return [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-fflags",
    "+genpts",
    "-f",
    "h264",
    "-framerate",
    String(options.fps),
    "-i",
    options.video,
    ...(options.audioStart !== undefined && options.audioDuration !== undefined
      ? [
          "-ss",
          options.audioStart.toFixed(3),
          "-t",
          options.audioDuration.toFixed(3),
        ]
      : []),
    "-i",
    options.wav,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    // Horodatage image par image, imposé : sans lui, le délai déclaré dans le flux de l'encodeur
    // du navigateur comprimait la vidéo à quelques secondes (constaté sur un export réel).
    "-bsf:v",
    `setts=ts=N/(${options.fps}*TB)`,
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-movflags",
    "+faststart",
    options.out,
  ];
}
