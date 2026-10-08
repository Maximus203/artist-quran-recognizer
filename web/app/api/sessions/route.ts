import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import {
  listSessions,
  readResult,
  readReview,
  saveSession,
  sessionDir,
  sha,
  type Session,
} from "@/lib/store";
import { parseRecognition } from "@/lib/recognition";
import { isLocalRequest } from "@/lib/local-request";
import { acceptedAudioExtensions } from "@/lib/audio-upload";

export const runtime = "nodejs";
const maxBytes = Number(process.env.AQR_MAX_UPLOAD_BYTES || 300 * 1024 * 1024);
export async function GET(request: NextRequest) {
  if (!isLocalRequest(request))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  return NextResponse.json(await listSessions());
}
export async function POST(request: NextRequest) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof File))
      return NextResponse.json({ error: "Choisis un audio." }, { status: 400 });
    const extension = path.extname(file.name).toLowerCase();
    if (
      !acceptedAudioExtensions.has(extension) ||
      file.size === 0 ||
      file.size > maxBytes
    )
      return NextResponse.json(
        { error: "Format ou taille non accepté (maximum 300 Mo par défaut)." },
        { status: 400 },
      );
    const bytes = Buffer.from(await file.arrayBuffer());
    const audio_sha256 = sha(bytes);
    const source_kind = form.get("source_kind");
    if (
      source_kind !== null &&
      source_kind !== "file" &&
      source_kind !== "microphone"
    )
      return NextResponse.json(
        { error: "Origine audio invalide." },
        { status: 400 },
      );
    const imported = form.get("result");
    let prediction: Buffer | null = null;
    if (imported instanceof File && imported.size) {
      prediction = Buffer.from(await imported.arrayBuffer());
      const parsed = parseRecognition(JSON.parse(prediction.toString("utf8")));
      if (parsed.source.sha256.toLowerCase() !== audio_sha256)
        return NextResponse.json(
          { error: "Le SHA-256 du résultat ne correspond pas à l’audio." },
          { status: 400 },
        );
    }
    const id = randomUUID(),
      dir = sessionDir(id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `source${extension}`), bytes);
    if (prediction)
      await writeFile(
        path.join(dir, "prediction.recognition.json"),
        prediction,
      );
    const value: Session = {
      id,
      name: path.basename(file.name),
      extension,
      audio_sha256,
      size: file.size,
      source_kind: source_kind === "microphone" ? "microphone" : "file",
      created_at: new Date().toISOString(),
      state: prediction ? "done" : "ready",
      error: null,
      started_at: null,
      finished_at: prediction ? new Date().toISOString() : null,
      prediction_sha256: prediction ? sha(prediction) : null,
      pid: null,
    };
    await saveSession(value);
    return NextResponse.json(value, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import impossible" },
      { status: 400 },
    );
  }
}
