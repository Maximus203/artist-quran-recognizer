import { NextResponse } from "next/server";
import { launch, cancel } from "@/lib/jobs";
import { isLocalRequest } from "@/lib/local-request";
import { parseAsrChoice } from "@/lib/asr-choice";
export const runtime = "nodejs";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isLocalRequest(request, true))
    return NextResponse.json({ error: "Accès local requis" }, { status: 403 });
  try {
    const body: unknown = await request.json().catch(() => ({}));
    const asr = parseAsrChoice(
      body && typeof body === "object" && "asr" in body ? body.asr : undefined,
    );
    await launch((await params).id, asr);
    return NextResponse.json({ state: "running" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Démarrage impossible" },
      { status: 400 },
    );
  }
}
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
