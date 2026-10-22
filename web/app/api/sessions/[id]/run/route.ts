import { NextResponse } from "next/server";
import { launch, cancel, ensureQueueRecovered } from "@/lib/jobs";
import { httpError } from "@/lib/errors";
import { isLocalRequest } from "@/lib/local-request";
import { parseAsrChoice } from "@/lib/asr-choice";
export const runtime = "nodejs";

/** Corps facultatif `{ "asr": "…" }` ; vide = moteur de l'atelier. Un corps illisible est refusé. */
async function requestedAsr(request: Request) {
  const text = await request.text();
  if (text.trim() === "") return undefined;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Corps de requête illisible : du JSON est attendu.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error('Corps de requête invalide : { "asr": "…" } est attendu.');
  // Sans moteur demandé, `launch` applique celui de l'atelier (`AQR_ASR`, cascade par défaut) :
  // le même que l'import avec `autorun`.
  return "asr" in body ? parseAsrChoice(body.asr) : undefined;
}

/** Met l'analyse en file : `{ state: "running" | "queued", queue_position }`. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const asr = await requestedAsr(request);
    await ensureQueueRecovered().catch(() => []);
    return NextResponse.json(await launch((await params).id, asr));
  } catch (e) {
    const { status, message } = httpError(e, "Démarrage impossible");
    return NextResponse.json({ error: message }, { status });
  }
}
/** Annule l'analyse : retirée de la file si elle attend, processus tué si elle tourne. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    await cancel((await params).id);
    return NextResponse.json({ state: "cancelled" });
  } catch (e) {
    const { status, message } = httpError(e, "Annulation impossible");
    return NextResponse.json({ error: message }, { status });
  }
}
