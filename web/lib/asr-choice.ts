export type AsrChoice = "fastconformer" | "whisper";

export function parseAsrChoice(value: unknown): AsrChoice {
  if (value === undefined || value === null) return "fastconformer";
  if (value === "fastconformer" || value === "whisper") return value;
  if (value === "muno-streaming")
    throw new Error("Le modèle Muno est indisponible : accès aux poids en attente.");
  throw new Error("Moteur de reconnaissance inconnu.");
}
