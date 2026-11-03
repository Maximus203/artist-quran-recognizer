/**
 * Écho de l'écoute (réverbération) : fonctions PURES. Le montage Web Audio est dans
 * `app/atelier/echo-graph.ts` ; ici, le dosage et la génération de la « queue » de réverbération.
 * L'écho ne s'applique qu'à l'écoute dans le navigateur : il n'entre ni dans les mesures du moteur ni dans la vidéo exportée.
 */
export const ECHO = { min: 0, max: 1, step: 0.05, defaultValue: 0 } as const;

export const clampEcho = (value: number): number =>
  Number.isFinite(value) ? Math.min(ECHO.max, Math.max(ECHO.min, value)) : 0;

/** Dosage du son direct (« sec ») et de l'écho (« mouillé ») : la voix reste toujours bien présente. */
export function echoMix(amount: number): { dry: number; wet: number } {
  const x = clampEcho(amount);
  return { dry: x === 0 ? 1 : 1 - 0.3 * x, wet: x * 1.1 };
}

/**
 * Réponse impulsionnelle d'une salle : du bruit qui s'éteint exponentiellement (`decay` : plus grand, plus
 * court). Deux canaux distincts donnent de la largeur. `rand` est injectable pour les tests.
 */
export function impulseResponse(
  sampleRate: number,
  seconds: number,
  decay: number,
  rand: () => number = Math.random,
): [Float32Array, Float32Array] {
  const length = Math.max(1, Math.round(sampleRate * seconds));
  const channel = () => {
    const data = new Float32Array(length);
    for (let i = 0; i < length; i++)
      data[i] = (rand() * 2 - 1) * Math.pow(1 - i / length, decay);
    return data;
  };
  return [channel(), channel()];
}
