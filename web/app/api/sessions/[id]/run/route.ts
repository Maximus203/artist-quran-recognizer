import { NextResponse } from "next/server";
import { launch, cancel, ensureQueueRecovered } from "@/lib/jobs";
import { isLocalRequest } from "@/lib/local-request";
import { parseAsrChoice } from "@/lib/asr-choice";
export const runtime = "nodejs";
/** Met l'analyse en file : `{ state: "running" | "queued", queue_position }`. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const body: unknown = await request.json().catch(() => ({}));
    // Sans moteur demandé, `launch` applique celui de l'atelier (`AQR_ASR`, cascade par défaut) :
    // le même que l'import avec `autorun`.
    const asr =
      body && typeof body === "object" && "asr" in body
        ? parseAsrChoice(body.asr)
        : undefined;
    await ensureQueueRecovered().catch(() => []);
    return NextResponse.json(await launch((await params).id, asr));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Démarrage impossible" },
      { status: 400 },
    );
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
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Annulation impossible" },
      { status: 400 },
    );
  }
}
