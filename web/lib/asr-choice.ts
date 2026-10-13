export type AsrChoice = "fastconformer" | "whisper" | "muno-streaming";

export function parseAsrChoice(value: unknown): AsrChoice {
  if (value === undefined || value === null) return "fastconformer";
  if (
    value === "fastconformer" ||
    value === "whisper" ||
    value === "muno-streaming"
  )
    return value;
  throw new Error("Moteur de reconnaissance inconnu.");
}
