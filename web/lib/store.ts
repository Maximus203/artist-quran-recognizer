import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  writeFile,
  readdir,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseRecognition, type Recognition } from "./recognition";
import { reviewSchema, type Review } from "./review";

export const ROOT =
  process.env.AQR_REVIEW_DIR ||
  path.join(os.homedir(), "AppData", "Local", "aqr-review");
export const REPO = path.resolve(process.cwd(), "..");
export type Session = {
  id: string;
  name: string;
  extension: string;
  audio_sha256: string;
  size: number;
  source_kind?: "file" | "microphone";
  created_at: string;
  state: "ready" | "running" | "done" | "failed" | "cancelled";
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  prediction_sha256: string | null;
  pid: number | null;
};
export function sha(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}
export function sessionDir(id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Identifiant invalide");
  return path.join(ROOT, "sessions", id);
}
export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(temp, file);
}
export async function readSession(id: string): Promise<Session> {
  const value = JSON.parse(
    await readFile(path.join(sessionDir(id), "session.json"), "utf8"),
  ) as Session;
  if (value.state !== "running") return value;
  try {
    const raw = await readFile(
      path.join(sessionDir(id), "source.recognition.json"),
    );
    const parsed = parseRecognition(JSON.parse(raw.toString("utf8")));
    if (parsed.source.sha256.toLowerCase() === value.audio_sha256) {
      const target = path.join(sessionDir(id), "prediction.recognition.json");
      await writeFile(target, raw);
      value.state = "done";
      value.prediction_sha256 = sha(raw);
      value.finished_at = new Date().toISOString();
      value.pid = null;
      await saveSession(value);
      return value;
    }
  } catch {
    /* sortie non encore disponible */
  }
  if (value.pid) {
    try {
      process.kill(value.pid, 0);
    } catch {
      value.state = "failed";
      value.error = "Le traitement s’est arrêté avant de produire un résultat.";
      value.finished_at = new Date().toISOString();
      value.pid = null;
      await saveSession(value);
    }
  }
  return value;
}
export async function saveSession(value: Session): Promise<void> {
  await atomicJson(path.join(sessionDir(value.id), "session.json"), value);
}
export async function readResult(
  id: string,
): Promise<{ raw: Buffer; parsed: Recognition } | null> {
  try {
    const raw = await readFile(
      path.join(sessionDir(id), "prediction.recognition.json"),
    );
    return { raw, parsed: parseRecognition(JSON.parse(raw.toString("utf8"))) };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function readReview(id: string): Promise<Review | null> {
  try {
    return reviewSchema.parse(
      JSON.parse(
        await readFile(path.join(sessionDir(id), "review.json"), "utf8"),
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}
export async function readReviewHistory(id: string): Promise<Review[]> {
  try {
    const dir = path.join(sessionDir(id), "revisions");
    const files = (await readdir(dir))
      .filter((name) => name.endsWith(".review.json"))
      .sort();
    return Promise.all(
      files.map(async (file) =>
        reviewSchema.parse(
          JSON.parse(await readFile(path.join(dir, file), "utf8")),
        ),
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export async function listSessions(): Promise<Session[]> {
  try {
    const dirs = await readdir(path.join(ROOT, "sessions"));
    const sessions = await Promise.all(
      dirs.map(async (id) => {
        try {
          return await readSession(id);
        } catch {
          return null;
        }
      }),
    );
    return sessions
      .filter((s): s is Session => s !== null)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export async function audioPath(id: string): Promise<string> {
  const s = await readSession(id);
  const p = path.join(sessionDir(id), `source${s.extension}`);
  await stat(p);
  return p;
}
