/** `cascade` : FastConformer partout, Whisper et Muno sur les passages douteux, départagés par
 * l'audio. Le choix n'est plus présenté dans l'interface (réglage avancé : `AQR_ASR`). */
export type AsrChoice =
  | "cascade"
  | "fastconformer"
  | "whisper"
  | "muno-streaming";

export function parseAsrChoice(value: unknown): AsrChoice {
  if (value === undefined || value === null) return "cascade";
  if (
    value === "cascade" ||
    value === "fastconformer" ||
    value === "whisper" ||
    value === "muno-streaming"
  )
    return value;
  throw new Error("Moteur de reconnaissance inconnu.");
}
