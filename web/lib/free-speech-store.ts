/** Lecture et relecture (validation humaine) du fichier de parole libre d'une session (ADR-0027). */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  parseFreeSpeech,
  type FreeSpeech,
  type FreeSpeechReview,
} from "./free-speech";
import { atomicJson, sessionDir } from "./store";

export const FREE_SPEECH_FILE = "prediction.free-speech.json";

const fileOf = (id: string) => path.join(sessionDir(id), FREE_SPEECH_FILE);

/** Le fichier de la session, ou null (absent, illisible ou invalide : jamais un doute affiché). */
export async function readFreeSpeech(id: string): Promise<FreeSpeech | null> {
  try {
    return parseFreeSpeech(JSON.parse(await readFile(fileOf(id), "utf8")));
  } catch {
    return null;
  }
}

export type ReviewOutcome = "ok" | "missing" | "not_translated";

/** Valide ou rejette un passage traduit ; un passage retenu n'a rien à relire. */
export async function setFreeSpeechReview(
  id: string,
  index: number,
  review: FreeSpeechReview,
): Promise<ReviewOutcome> {
  const doc = await readFreeSpeech(id);
  const item = doc?.items.find((i) => i.index === index);
  if (!doc || !item) return "missing";
  if (item.status !== "translated") return "not_translated";
  item.review = review;
  await atomicJson(fileOf(id), doc);
  return "ok";
}
